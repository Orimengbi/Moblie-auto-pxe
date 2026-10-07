import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseLeases, type Lease } from "./dnsmasq.ts";
import { describeChange, INVENTORY_SCRIPT, parseOsInventory, redfishComponents, summarizeComponents } from "./inventory.ts";
import { listLocalIpv4, sameSubnet } from "./net.ts";
import { sshKeyPath, taskPath } from "./paths.ts";
import { crawlRedfish, RedfishAuthError, redfishGetter, type RedfishGet } from "./redfish.ts";
import { renderRevokeScript } from "./render.ts";
import {
  bmcAccounts,
  filePayloadPath,
  getFile,
  getProject,
  getServer,
  getTask,
  listMachines,
  listNicPlans,
  listServers,
  readLeasesText,
  saveInventory,
  writeTask,
} from "./store.ts";
import type { HwChange, InventorySource, Machine, NicPlan, RemoteTask, ServerRow, TaskHostSource, TaskKind, TaskTarget, TaskTargetStatus } from "./types.ts";

const OUTPUT_LIMIT = 16000;
/** 采集脚本的原始输出要整段解析，不能像普通任务那样只留结尾。 */
const INVENTORY_OUTPUT_LIMIT = 4 * 1024 * 1024;

/** 小主机自己的 SSH 密钥。第一次用到时生成，私钥只留在数据目录。 */
export function consolePublicKey(): string {
  const key = sshKeyPath();
  if (!fs.existsSync(key)) {
    fs.mkdirSync(path.dirname(key), { recursive: true, mode: 0o700 });
    const made = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "pxe-console", "-f", key], { encoding: "utf8" });
    if (made.error || made.status !== 0) {
      throw new Error(`生成 SSH 密钥失败：${made.error?.message || made.stderr || "ssh-keygen 没有正常退出"}`);
    }
  }
  return fs.readFileSync(`${key}.pub`, "utf8").trim();
}

export interface HostContext {
  nics: NicPlan[];
  machines: Machine[];
  leases: Lease[];
  locals: string[];
}

/**
 * 找装好的系统现在的地址。先用和小主机同网段的系统地址或规划网卡，再用固定 IP，
 * 再用装机网的 DHCP 租约（系统地址配在业务网卡上时，PXE 口还是 DHCP），最后才用需要走路由的地址。
 */
export function resolveHost(row: Pick<ServerRow, "projectId" | "sn" | "bootMac" | "osAddress" | "osNetmask">, context: HostContext): { host: string; source: TaskHostSource } {
  if (row.osAddress && context.locals.some((ip) => sameSubnet(ip, row.osAddress!, row.osNetmask || "255.255.255.0"))) {
    return { host: row.osAddress, source: "sheet" };
  }
  const nics = context.nics.filter((item) => item.projectId === row.projectId && item.sn === row.sn);
  const local = nics.find((nic) => context.locals.some((ip) => sameSubnet(ip, nic.address, nic.netmask)));
  if (local) return { host: local.address, source: "nic" };
  const machine = row.bootMac ? context.machines.find((item) => item.mac === row.bootMac) : undefined;
  if (machine?.fixedIp) return { host: machine.fixedIp, source: "fixed" };
  const lease = row.bootMac ? context.leases.find((item) => item.active && item.mac === row.bootMac) : undefined;
  if (lease) return { host: lease.ip, source: "lease" };
  if (row.osAddress) return { host: row.osAddress, source: "sheet" };
  const routed = nics.find((nic) => nic.gateway) || nics[0];
  if (routed) return { host: routed.address, source: "nic" };
  return { host: "", source: "" };
}

export function hostContext(): HostContext {
  return {
    nics: listNicPlans(),
    machines: listMachines(),
    leases: parseLeases(readLeasesText()),
    locals: listLocalIpv4(),
  };
}

export interface TaskInput {
  kind?: TaskKind;
  /** 采集硬件读哪几边，默认两边都读。 */
  sources?: InventorySource[];
  name?: string;
  script?: string;
  serverIds: string[];
  fileIds?: string[];
  concurrency?: number;
  timeoutSec?: number;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}需要是 ${min} 到 ${max} 的整数`);
  return n;
}

export function createTask(projectId: string, input: TaskInput, context: HostContext = hostContext()): RemoteTask {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  const kind: TaskKind = input.kind === "revoke" || input.kind === "inventory" ? input.kind : "script";
  const script =
    kind === "revoke" ? renderRevokeScript(consolePublicKey()) : kind === "inventory" ? INVENTORY_SCRIPT : (input.script || "").replace(/\r\n/g, "\n");
  if (!script.trim()) throw new Error("脚本是空的");
  if (script.length > 200000) throw new Error("脚本超过 200KB");
  const sources = kind === "inventory" ? (["os", "bmc"] as const).filter((source) => !input.sources || input.sources.includes(source)) : [];
  if (kind === "inventory" && !sources.length) throw new Error("至少选一种采集方式");
  const defaultName = kind === "revoke" ? "交付清理：撤掉控制台公钥" : kind === "inventory" ? "采集硬件配置" : script.trim().split("\n")[0].slice(0, 80);
  const name = (input.name || "").trim().slice(0, 80) || defaultName;
  const fileIds = kind === "script" ? [...new Set(input.fileIds || [])] : [];
  for (const id of fileIds) {
    if (!getFile(id)) throw new Error("选中的文件已经不存在，刷新页面再选");
  }
  const rows = listServers().filter((row) => row.projectId === project.id);
  const wanted = [...new Set(input.serverIds || [])];
  if (!wanted.length) throw new Error("至少选一台机器");
  const targets: TaskTarget[] = wanted.map((id) => {
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error("选中的机器不在这个项目里，刷新页面再选");
    const found = resolveHost(row, context);
    // 采集硬件只读 BMC 时不需要系统地址；两边都读时有一边能连就去试。
    const reachable = kind === "inventory" ? (sources.includes("os") && Boolean(found.host)) || (sources.includes("bmc") && Boolean(row.bmcIp)) : Boolean(found.host);
    const missing =
      kind === "inventory"
        ? `${sources.includes("os") ? "找不到系统地址" : ""}${sources.length === 2 ? "，" : ""}${sources.includes("bmc") ? "还没有 BMC 地址" : ""}`
        : "找不到这台机器的地址：服务器表没填系统地址，DHCP 租约里也没有它的装机网卡";
    return {
      serverId: row.id,
      sn: row.sn,
      host: found.host,
      hostSource: found.source,
      status: reachable ? "pending" : "unreachable",
      exitCode: null,
      output: reachable ? "" : missing,
    };
  });
  const task: RemoteTask = {
    id: crypto.randomUUID(),
    projectId: project.id,
    kind,
    name,
    script,
    fileIds,
    concurrency: boundedInt(input.concurrency, 10, 1, 50, "并发数"),
    timeoutSec: boundedInt(input.timeoutSec, 600, 10, 7200, "单台超时"),
    status: targets.some((item) => item.status === "pending") ? "running" : "done",
    targets,
    ...(kind === "inventory" ? { inventorySources: [...sources] } : {}),
    createdAt: new Date().toISOString(),
  };
  if (task.status === "done") task.finishedAt = task.createdAt;
  writeTask(task);
  return task;
}

export function startTask(task: RemoteTask): void {
  if (task.status !== "running") return;
  const script = path.join(process.cwd(), "scripts", "run-task.ts");
  const log = fs.openSync(taskPath(task.id).replace(/\.json$/, ".log"), "a");
  const child = spawn(process.execPath, ["--experimental-strip-types", script, task.id], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
}

export interface ExecResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

/** 执行一条命令，stdin 可选。deadline 是绝对时间，到点就杀掉。limit 是输出最多留多少字符，超了只留结尾。 */
export type Exec = (command: string, args: string[], stdin: string | null, deadline: number, limit?: number) => Promise<ExecResult>;

export const defaultExec: Exec = (command, args, stdin, deadline, limit = OUTPUT_LIMIT) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const keep = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > limit * 2) output = output.slice(-limit);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.max(0, deadline - Date.now()));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}${error.message}\n`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
    child.stdin.end(stdin ?? "");
  });

function sshOptions(): string[] {
  // 装机网上的机器会反复重装，主机密钥每次都变，所以不记 known_hosts。
  return [
    "-i",
    sshKeyPath(),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "LogLevel=ERROR",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
  ];
}

function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tail(text: string): string {
  return text.length > OUTPUT_LIMIT ? `……前面省略……\n${text.slice(-OUTPUT_LIMIT)}` : text;
}

export async function runOnHost(
  task: Pick<RemoteTask, "id" | "script" | "timeoutSec">,
  target: Pick<TaskTarget, "host" | "sn">,
  files: string[],
  exec: Exec,
): Promise<{ status: TaskTargetStatus; exitCode: number | null; output: string }> {
  const deadline = Date.now() + task.timeoutSec * 1000;
  const remote = `root@${target.host}`;
  const dir = `/tmp/pxe-task-${task.id}`;
  let log = "";
  const timedOut = () => ({ status: "timeout" as const, exitCode: null, output: tail(`${log}超过 ${task.timeoutSec} 秒，已中止\n`) });

  const prepared = await exec("ssh", [...sshOptions(), remote, `mkdir -p ${shq(dir)}`], null, deadline);
  if (prepared.timedOut) return timedOut();
  if (prepared.code !== 0) {
    return { status: "unreachable", exitCode: prepared.code, output: tail(`${prepared.output}SSH 登录 ${target.host} 失败。机器没开、地址不对，或者装机时没写入控制台公钥\n`) };
  }
  if (files.length) {
    const copied = await exec("scp", [...sshOptions(), "-q", "-p", ...files, `${remote}:${dir}/`], null, deadline);
    log += copied.output;
    if (copied.timedOut) return timedOut();
    if (copied.code !== 0) return { status: "failed", exitCode: copied.code, output: tail(`${log}上传文件失败\n`) };
  }
  const header = [
    `export PXE_FILES=${shq(dir)}`,
    `export PXE_SN=${shq(target.sn)}`,
    `trap 'cd /; rm -rf "$PXE_FILES"' EXIT`,
    'cd "$PXE_FILES"',
    "",
  ].join("\n");
  const ran = await exec("ssh", [...sshOptions(), remote, "bash -s"], `${header}${task.script}\n`, deadline);
  log += ran.output;
  if (ran.timedOut) return timedOut();
  if (ran.code === 255) return { status: "unreachable", exitCode: 255, output: tail(`${log}SSH 连接中断\n`) };
  return { status: ran.code === 0 ? "ok" : "failed", exitCode: ran.code, output: tail(log) };
}

/** 用某台 BMC 的账号做一个 Redfish 读取函数。测试时换成假的。 */
export type RedfishFactory = (host: string, user: string, password: string) => RedfishGet;

function changeLines(changes: HwChange[] | undefined): string[] {
  if (!changes) return ["第一次采集"];
  if (!changes.length) return ["和上次采集相比没有变化"];
  return [`和上次采集相比有 ${changes.length} 处变化：`, ...changes.slice(0, 20).map((change) => `  ${describeChange(change)}`), ...(changes.length > 20 ? ["  ……"] : [])];
}

function withDeadline<T>(work: Promise<T>, deadline: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时`)), Math.max(0, deadline - Date.now()));
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 采集一台机器的硬件：SSH 进系统跑采集脚本，再读 BMC 的 Redfish，两边各存一次。
 * 有一边成功就把结果存下；要读的两边都成功才算成功。
 */
export async function collectInventory(
  task: Pick<RemoteTask, "projectId" | "timeoutSec" | "inventorySources">,
  target: Pick<TaskTarget, "serverId" | "host" | "sn">,
  exec: Exec,
  redfish: RedfishFactory = redfishGetter,
): Promise<{ status: TaskTargetStatus; exitCode: number | null; output: string }> {
  const deadline = Date.now() + task.timeoutSec * 1000;
  const sources = task.inventorySources || ["os", "bmc"];
  const row = getServer(task.projectId, target.serverId);
  const lines: string[] = [];
  let ok = 0;
  let tried = 0;
  let reached = false;

  if (sources.includes("os")) {
    if (!target.host) {
      lines.push("系统内：找不到系统地址，跳过");
    } else {
      tried++;
      const ran = await exec("ssh", [...sshOptions(), `root@${target.host}`, "bash -s"], INVENTORY_SCRIPT, deadline, INVENTORY_OUTPUT_LIMIT);
      if (ran.timedOut) {
        lines.push(`系统内（${target.host}）：超过 ${task.timeoutSec} 秒，已中止`);
      } else if (ran.code === 255 || !ran.output.includes("===PXEINV ")) {
        lines.push(`系统内（${target.host}）：SSH 登录失败。机器没开、地址不对，或者装机时没写入控制台公钥`, tail(ran.output).trim());
      } else {
        reached = true;
        const parsed = parseOsInventory(ran.output);
        const saved = await saveInventory({
          serverId: target.serverId,
          projectId: task.projectId,
          sn: target.sn,
          source: "os",
          at: new Date().toISOString(),
          host: target.host,
          components: parsed.components,
          warnings: parsed.warnings,
        });
        ok++;
        lines.push(`系统内（${target.host}）：`, ...summarizeComponents(parsed.components).map((line) => `  ${line}`), ...changeLines(saved.changes), ...parsed.warnings.map((line) => `  提示：${line}`));
      }
    }
  }

  if (sources.includes("bmc")) {
    const accounts = row ? bmcAccounts(row) : [];
    if (!row?.bmcIp) {
      lines.push("BMC：还没有 BMC 地址，跳过");
    } else if (!accounts.length) {
      lines.push(`BMC（${row.bmcIp}）：服务器表里没有 IPMI 账号密码，跳过`);
    } else {
      tried++;
      let done = false;
      let failure = "";
      for (const account of accounts) {
        try {
          const raw = await withDeadline(crawlRedfish(redfish(row.bmcIp, account.user, account.password)), deadline, "读 Redfish ");
          reached = true;
          const components = redfishComponents(raw);
          const warnings = raw.errors.length ? [`有 ${raw.errors.length} 个 Redfish 路径没读到，例如 ${raw.errors[0]}`] : [];
          const saved = await saveInventory({
            serverId: target.serverId,
            projectId: task.projectId,
            sn: target.sn,
            source: "bmc",
            at: new Date().toISOString(),
            host: row.bmcIp,
            components,
            warnings,
          });
          ok++;
          done = true;
          lines.push(`BMC（${row.bmcIp}）：`, ...summarizeComponents(components).map((line) => `  ${line}`), ...changeLines(saved.changes), ...warnings.map((line) => `  提示：${line}`));
          break;
        } catch (error) {
          failure = error instanceof Error ? error.message : "读取失败";
          if (!(error instanceof RedfishAuthError)) break;
        }
      }
      if (!done) lines.push(`BMC（${row.bmcIp}）：${failure}`);
    }
  }

  const output = tail(`${lines.filter(Boolean).join("\n")}\n`);
  if (ok > 0 && ok === tried) return { status: "ok", exitCode: 0, output };
  if (Date.now() >= deadline) return { status: "timeout", exitCode: null, output };
  return { status: ok > 0 || reached ? "failed" : "unreachable", exitCode: null, output };
}

/** 在独立进程里跑完一个任务，每台机器状态变化时写回任务文件。 */
export async function runTask(id: string, exec: Exec = defaultExec, redfish: RedfishFactory = redfishGetter): Promise<RemoteTask> {
  const loaded = getTask(id);
  if (!loaded) throw new Error("任务不存在");
  const task: RemoteTask = { ...loaded, status: "running", runnerPid: process.pid };
  const files = task.fileIds.map((fileId) => {
    const file = getFile(fileId);
    if (!file) throw new Error("任务要用的文件已经被删掉");
    return filePayloadPath(file);
  });
  writeTask(task);
  const queue = task.targets.filter((target) => target.status === "pending");
  const worker = async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      target.status = "running";
      target.startedAt = new Date().toISOString();
      writeTask(task);
      try {
        Object.assign(target, task.kind === "inventory" ? await collectInventory(task, target, exec, redfish) : await runOnHost(task, target, files, exec));
      } catch (error) {
        target.status = "failed";
        target.output = error instanceof Error ? error.message : "执行失败";
      }
      target.finishedAt = new Date().toISOString();
      writeTask(task);
    }
  };
  await Promise.all(Array.from({ length: Math.min(task.concurrency, queue.length) }, worker));
  task.status = "done";
  task.finishedAt = new Date().toISOString();
  writeTask(task);
  return task;
}
