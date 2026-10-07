import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseLeases, type Lease } from "./dnsmasq.ts";
import { listLocalIpv4, sameSubnet } from "./net.ts";
import { sshKeyPath, taskPath } from "./paths.ts";
import { renderRevokeScript } from "./render.ts";
import {
  filePayloadPath,
  getFile,
  getProject,
  getTask,
  listMachines,
  listNicPlans,
  listServers,
  readLeasesText,
  writeTask,
} from "./store.ts";
import type { Machine, NicPlan, RemoteTask, ServerRow, TaskHostSource, TaskKind, TaskTarget, TaskTargetStatus } from "./types.ts";

const OUTPUT_LIMIT = 16000;

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
  const kind: TaskKind = input.kind === "revoke" ? "revoke" : "script";
  const script = kind === "revoke" ? renderRevokeScript(consolePublicKey()) : (input.script || "").replace(/\r\n/g, "\n");
  if (!script.trim()) throw new Error("脚本是空的");
  if (script.length > 200000) throw new Error("脚本超过 200KB");
  const name = (input.name || "").trim().slice(0, 80) || (kind === "revoke" ? "交付清理：撤掉控制台公钥" : script.trim().split("\n")[0].slice(0, 80));
  const fileIds = kind === "revoke" ? [] : [...new Set(input.fileIds || [])];
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
    return {
      serverId: row.id,
      sn: row.sn,
      host: found.host,
      hostSource: found.source,
      status: found.host ? "pending" : "unreachable",
      exitCode: null,
      output: found.host ? "" : "找不到这台机器的地址：服务器表没填系统地址，DHCP 租约里也没有它的装机网卡",
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

/** 执行一条命令，stdin 可选。deadline 是绝对时间，到点就杀掉。 */
export type Exec = (command: string, args: string[], stdin: string | null, deadline: number) => Promise<ExecResult>;

export const defaultExec: Exec = (command, args, stdin, deadline) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const keep = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > OUTPUT_LIMIT * 2) output = output.slice(-OUTPUT_LIMIT);
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

/** 在独立进程里跑完一个任务，每台机器状态变化时写回任务文件。 */
export async function runTask(id: string, exec: Exec = defaultExec): Promise<RemoteTask> {
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
        Object.assign(target, await runOnHost(task, target, files, exec));
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
