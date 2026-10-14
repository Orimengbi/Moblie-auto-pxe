import { spawn, spawnSync } from "node:child_process";
import { runProcess } from "./process.ts";
import fs from "node:fs";
import path from "node:path";
import { parseLeases, type Lease } from "./dnsmasq.ts";
import { cleanCollectKinds, describeChange, INVENTORY_SCRIPT, KIND_LABEL, parseOsInventory, redfishComponents, summarizeComponents } from "./inventory.ts";
import { portSummary, redfishPorts } from "./ports.ts";
import { listLocalIpv4, sameSubnet } from "./net.ts";
import { sshKeyPath, taskPath } from "./paths.ts";
import { OPTICS_SCRIPT, parseOptics } from "./optics.ts";
import { bmcColdReset, defaultIpmiExec, firstWorkingAccount, ipmiFailure, type IpmiExec } from "./ipmi-remote.ts";
import { crawlRedfish, RedfishAuthError, redfishGetter, type RedfishGet } from "./redfish.ts";
import { renderRevokeScript } from "./render.ts";
import { jumpFor, jumpLabel, listJumpHosts, type JumpHost } from "./ssh-jump.ts";
import { buildLogBundle, cleanupBundles, taskBundleDir } from "./bmc-log-bundle.ts";
import { applyUserChange, cleanUserChange } from "./ipmi-users.ts";
import { describeUserChange, type BmcUserChange } from "./ipmi-user-types.ts";
import { cleanLogKinds, DEFAULT_LOG_KINDS, describeLogKinds } from "./log-kinds.ts";
import { addEvent, assetBmcAccounts, getAsset } from "./assets.ts";
import { BMC_SETTING_LABEL } from "./asset-labels.ts";
import { changeClock, collectSettings, openSession, validOffset, type ClockChange } from "./bmc-redfish.ts";
import { filePayloadPath, getFile, getProject, getTask, listMachines, listNicPlans, readLeasesText, saveInventory, saveOptics, writeTask } from "./store.ts";
import type { Asset, BmcResetVia, BmcSettingKind, HwChange, HwComponent, HwKind, HwPort, InventorySource, OpticsReading, Machine, NicPlan, RemoteTask, ServerRow, TaskHostSource, TaskKind, TaskTarget, TaskTargetStatus } from "./types.ts";
import { shq } from "./shq.ts";

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
export function resolveHost(
  row: Pick<ServerRow, "sn" | "bootMac" | "osAddress" | "osNetmask"> & { projectId?: string },
  context: HostContext,
): { host: string; source: TaskHostSource } {
  if (row.osAddress && context.locals.some((ip) => sameSubnet(ip, row.osAddress!, row.osNetmask || "255.255.255.0"))) {
    return { host: row.osAddress, source: "sheet" };
  }
  // 资产不属于哪个批次，用所有批次里这个序列号的网卡规划。
  const nics = context.nics.filter((item) => (!row.projectId || item.projectId === row.projectId) && item.sn === row.sn);
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

/** 资产的系统地址：资产上的系统地址和装机网卡 MAC，加上各批次的网卡规划。 */
export function resolveAssetHost(asset: Pick<Asset, "sn" | "bootMac" | "osAddress" | "osNetmask">, context: HostContext): { host: string; source: TaskHostSource } {
  return resolveHost({ sn: asset.sn, bootMac: asset.bootMac || undefined, osAddress: asset.osAddress || undefined, osNetmask: asset.osNetmask || undefined }, context);
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
  /** 采集硬件时顺带读 BMC 设置、BIOS 设置，默认不读。 */
  settings?: BmcSettingKind[];
  /** 采集硬件只采这几类部件（见 COLLECT_KINDS），不给或全给就是全采。 */
  kinds?: HwKind[];
  /** 重启 BMC 任务走带外还是带内，默认带外。 */
  bmcReset?: BmcResetVia;
  /** 设 BMC 时区和 NTP 任务要改成什么。 */
  bmcClock?: ClockChange;
  /** BMC 用户任务在每台上做什么。 */
  bmcUser?: BmcUserChange;
  /** 收集 BMC 日志任务要哪几类。 */
  bmcLogs?: string[];
  name?: string;
  script?: string;
  /** 资产 id。 */
  assetIds: string[];
  /** 从装机批次页发起时带上，任务列表里按批次显示。 */
  projectId?: string;
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

export function createTask(input: TaskInput, context: HostContext = hostContext()): RemoteTask {
  const project = input.projectId ? getProject(input.projectId) : null;
  if (input.projectId && !project) throw new Error("装机批次不存在");
  const kind: TaskKind = (["revoke", "inventory", "bmc-reset", "bmc-clock", "bmc-logs", "bmc-user"] as const).find((item) => item === input.kind) || "script";
  const clock = kind === "bmc-clock" ? cleanClock(input.bmcClock) : undefined;
  const userChange = kind === "bmc-user" ? cleanUserChange(input.bmcUser) : undefined;
  const logKinds = kind === "bmc-logs" ? cleanLogKinds(input.bmcLogs?.length ? input.bmcLogs : DEFAULT_LOG_KINDS) : undefined;
  const via: BmcResetVia = input.bmcReset === "inband" ? "inband" : "outband";
  const script =
    kind === "revoke"
      ? renderRevokeScript(consolePublicKey())
      : kind === "inventory"
        ? INVENTORY_SCRIPT
        : kind === "bmc-reset"
          ? via === "inband"
            ? BMC_RESET_SCRIPT
            : "# 带外：控制台用资产上的 BMC 账号执行\nipmitool -I lanplus -H <BMC 地址> mc reset cold\n"
          : kind === "bmc-clock"
            ? `# 经 Redfish 改 BMC\n${JSON.stringify(clock, null, 2)}\n`
            : kind === "bmc-logs"
              ? `# 控制台经 IPMI 和 Redfish 读每台 BMC 的日志，每台打成一个 tar.gz\n# 类型：${describeLogKinds(logKinds!)}\n`
              : kind === "bmc-user"
                ? `# 经 IPMI 在每台 BMC 上按用户名改（槽位号各台可以不一样）\n${JSON.stringify({ ...userChange, ...(userChange!.password ? { password: "******" } : {}) }, null, 2)}\n`
                : (input.script || "").replace(/\r\n/g, "\n");
  if (!script.trim()) throw new Error("脚本是空的");
  if (script.length > 200000) throw new Error("脚本超过 200KB");
  const sources = kind === "inventory" ? (["os", "bmc"] as const).filter((source) => !input.sources || input.sources.includes(source)) : [];
  const settings = kind === "inventory" ? (["overview", "bios", "firmware"] as const).filter((item) => input.settings?.includes(item)) : [];
  if (kind === "inventory" && !sources.length && !settings.length) throw new Error("至少选一种采集方式");
  const partKinds = kind === "inventory" && sources.length ? cleanCollectKinds(input.kinds) : undefined;
  const settingsName = settings.map((item) => BMC_SETTING_LABEL[item]).join("、");
  const inventoryName = sources.length ? `采集硬件配置${partKinds ? `（${partKinds.map((item) => KIND_LABEL[item]).join("、")}）` : ""}${settings.length ? `、${settingsName}` : ""}` : `读取 ${settingsName}`;
  const defaultName =
    kind === "revoke" ? "交付清理：撤掉控制台公钥" : kind === "inventory" ? inventoryName : kind === "bmc-reset" ? `重启 BMC（${via === "inband" ? "带内" : "带外"}）` : kind === "bmc-clock" ? clockName(clock!) : kind === "bmc-logs" ? `收集 BMC 日志（${describeLogKinds(logKinds!)}）`.slice(0, 80) : kind === "bmc-user" ? describeUserChange(userChange!).slice(0, 80) : script.trim().split("\n")[0].slice(0, 80);
  const name = (input.name || "").trim().slice(0, 80) || defaultName;
  const fileIds = kind === "script" ? [...new Set(input.fileIds || [])] : [];
  for (const id of fileIds) {
    if (!getFile(id)) throw new Error("选中的文件已经不存在，刷新页面再选");
  }
  const wanted = [...new Set(input.assetIds || [])];
  if (!wanted.length) throw new Error("至少选一台机器");
  if (wanted.length > 2000) throw new Error("一次最多 2000 台");
  const targets: TaskTarget[] = wanted.map((id) => {
    const row = getAsset(id);
    if (!row) throw new Error("选中的机器已经不在资产里，刷新页面再选");
    if ((kind === "bmc-reset" && via === "outband") || kind === "bmc-clock" || kind === "bmc-logs" || kind === "bmc-user") {
      // 带外连的是 BMC，任务里「地址」一栏显示 BMC 地址。
      const ready = Boolean(row.bmcIp && assetBmcAccounts(row).length);
      return {
        serverId: row.id,
        sn: row.sn,
        host: row.bmcIp || "",
        hostSource: "",
        status: ready ? "pending" : "unreachable",
        exitCode: null,
        output: ready ? "" : `${row.bmcIp ? "资产上没有 BMC 账号密码" : "还没有 BMC 地址"}${kind === "bmc-reset" ? "，可以试带内" : ""}`,
      } satisfies TaskTarget;
    }
    const found = resolveAssetHost(row, context);
    // 采集硬件只读 BMC 时不需要系统地址；两边都读时有一边能连就去试。BMC、BIOS 设置也是从 BMC 读。
    const viaBmc = sources.includes("bmc") || settings.length > 0;
    const reachable = kind === "inventory" ? (sources.includes("os") && Boolean(found.host)) || (viaBmc && Boolean(row.bmcIp)) : Boolean(found.host);
    const missing =
      kind === "inventory"
        ? [sources.includes("os") ? "找不到系统地址" : "", viaBmc ? "还没有 BMC 地址" : ""].filter(Boolean).join("，")
        : "找不到这台机器的地址：资产和服务器表都没填系统地址，DHCP 租约里也没有它的装机网卡";
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
    projectId: project?.id || "",
    kind,
    name,
    script,
    fileIds,
    concurrency: boundedInt(input.concurrency, 10, 1, 50, "并发数"),
    timeoutSec: boundedInt(input.timeoutSec, 600, 10, 7200, "单台超时"),
    status: targets.some((item) => item.status === "pending") ? "running" : "done",
    targets,
    ...(kind === "inventory" ? { inventorySources: [...sources] } : {}),
    ...(settings.length ? { inventorySettings: [...settings] } : {}),
    ...(partKinds ? { inventoryKinds: partKinds } : {}),
    ...(kind === "bmc-reset" ? { bmcReset: via } : {}),
    ...(clock ? { bmcClock: clock } : {}),
    ...(userChange ? { bmcUser: userChange } : {}),
    ...(logKinds ? { bmcLogs: logKinds } : {}),
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
  // 子进程已经拿到了这个文件，父进程这边要关掉，不然每个任务漏一个句柄。
  fs.closeSync(log);
}

export interface ExecResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

/** 执行一条命令，stdin 可选。deadline 是绝对时间，到点就杀掉。limit 是输出最多留多少字符，超了只留结尾。 */
export type Exec = (command: string, args: string[], stdin: string | null, deadline: number, limit?: number) => Promise<ExecResult>;

export const defaultExec: Exec = async (command, args, stdin, deadline, limit = OUTPUT_LIMIT) => {
  try {
    const result = await runProcess(command, args, { timeoutMs: deadline - Date.now(), stdin: stdin ?? "", limit });
    return { code: result.code, output: result.output, timedOut: result.timedOut };
  } catch (error) {
    return { code: null, output: `${error instanceof Error ? error.message : error}\n`, timedOut: false };
  }
};

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

/** 跳板机上登目标用的选项：和直连一样不记主机密钥、连不上 8 秒就放弃。 */
const JUMP_INNER_OPTIONS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];

/**
 * 只登跳板机本身跑一条命令。到跳板机的连接复用一条（ControlMaster）：监控一轮要经它登几百台，
 * 每台都新开一条 SSH 会被跳板机的 sshd 当成扫描，整个控制台 IP 被封（"Not allowed at this time"）。
 */
export function jumpSshArgs(jump: JumpHost, command: string): string[] {
  const mux = ["-o", "ControlMaster=auto", "-o", `ControlPath=${path.join(path.dirname(sshKeyPath()), "cm-%C")}`, "-o", "ControlPersist=300"];
  return [...sshOptions(), ...mux, "-p", String(jump.port), `${jump.user}@${jump.host}`, command];
}

/** 跳板机这一跳最近一次试连的结果。登不上的 5 分钟内不再去连，免得一轮几百次失败把控制台 IP 封得更久。 */
const jumpChecks = new Map<string, { at: number; error: string; pending?: Promise<string> }>();
const JUMP_OK_MS = 60_000;
const JUMP_DOWN_MS = 5 * 60_000;

function jumpKey(jump: JumpHost): string {
  return `${jump.user}@${jump.host}:${jump.port}`;
}

function jumpDownMessage(jump: JumpHost, output: string): string {
  const said = output.trim().split("\n").slice(-2).join(" ").slice(0, 200);
  const hint = /Not allowed at this time/i.test(output)
    ? "跳板机的 sshd 因为这个 IP 登录失败太多次，暂时把控制台封了（一般 10 分钟内自动解开）。先确认控制台公钥已放进跳板机的 authorized_keys"
    : /Permission denied/i.test(output)
      ? "跳板机不认控制台的密钥，把设置页里的控制台公钥加进跳板机的 authorized_keys"
      : "跳板机连不上";
  return `跳板机 ${jumpLabel(jump)} 登不上：${hint}${said ? `（${said}）` : ""}`;
}

/** 经跳板机之前先确认跳板机这一跳通不通，结果缓存，同时来的请求共用一次试连。通了返回空串。 */
export async function checkJump(jump: JumpHost, exec: Exec = defaultExec): Promise<string> {
  const key = jumpKey(jump);
  const cached = jumpChecks.get(key);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() - cached.at < (cached.error ? JUMP_DOWN_MS : JUMP_OK_MS)) return cached.error;
  const pending = exec("ssh", jumpSshArgs(jump, "true"), null, Date.now() + 20_000).then(
    (ran) => (ran.code === 0 ? "" : jumpDownMessage(jump, ran.output)),
    (error) => jumpDownMessage(jump, String(error)),
  );
  jumpChecks.set(key, { at: Date.now(), error: "", pending });
  const error = await pending;
  jumpChecks.set(key, { at: Date.now(), error });
  return error;
}

/** 设置里改了跳板机或手动试连后，忘掉之前的结果。 */
export function forgetJumpChecks(): void {
  jumpChecks.clear();
}

/** SSH 进一台机器跑一条命令；要经跳板机而跳板机登不上时不去连，直接当 255 返回原因。 */
async function sshExec(exec: Exec, host: string, command: string, stdin: string | null, deadline: number, limit?: number, jumps: JumpHost[] = listJumpHosts()): Promise<ExecResult> {
  const jump = jumpFor(host, jumps);
  if (jump) {
    const error = await checkJump(jump, exec);
    if (error) return { code: 255, output: `${error}\n`, timedOut: false };
  }
  const ran = await exec("ssh", sshArgs(host, command, jumps), stdin, deadline, limit);
  return jump ? { ...ran, output: ran.output.replace(MUX_NOISE, "") } : ran;
}

/** 复用的连接会话满了（sshd 的 MaxSessions）时 ssh 自己另开一条，会打这两行，不是错误。 */
const MUX_NOISE = /^(mux_client_request_session: session request failed.*|ControlSocket .* already exists, disabling multiplexing)\r?\n/gm;

/**
 * 登一台机器跑一条命令的 ssh 参数。目标网段配了跳板机时，先用控制台的密钥登跳板机，
 * 再在跳板机上用它自己的密钥登目标；stdin 和退出码穿过两跳，哪一跳连不上都是 255。
 */
export function sshArgs(host: string, command: string, jumps: JumpHost[] = listJumpHosts()): string[] {
  const jump = jumpFor(host, jumps);
  if (!jump) return [...sshOptions(), `root@${host}`, command];
  const inner = ["ssh", ...JUMP_INNER_OPTIONS, "-p", String(jump.targetPort), ...(jump.targetKey ? ["-i", jump.targetKey] : []), `${jump.targetUser}@${host}`, command];
  return jumpSshArgs(jump, inner.map(shq).join(" "));
}

/** SSH 登不上时的提示，经跳板机的说明是哪一台。 */
export function sshFailure(host: string, jumps: JumpHost[] = listJumpHosts()): string {
  const jump = jumpFor(host, jumps);
  const down = jump && jumpChecks.get(jumpKey(jump))?.error;
  if (down) return down;
  if (jump) return `经跳板机 ${jumpLabel(jump)} 登录 ${host} 失败。跳板机上没放控制台公钥、跳板机连不上目标，或者目标端口、私钥不对`;
  return `SSH 登录 ${host} 失败。机器没开、地址不对，或者装机时没写入控制台公钥`;
}

/** 用控制台的密钥以 root SSH 进一台机器跑一段 bash（目标网段配了跳板机就经跳板机）。监控用。 */
export function runSsh(host: string, script: string, timeoutMs = 120_000, exec: Exec = defaultExec): Promise<ExecResult> {
  return sshExec(exec, host, "bash -s", script, Date.now() + timeoutMs, INVENTORY_OUTPUT_LIMIT);
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

  const jumps = listJumpHosts();
  const prepared = await sshExec(exec, target.host, `mkdir -p ${shq(dir)}`, null, deadline, undefined, jumps);
  if (prepared.timedOut) return timedOut();
  if (prepared.code !== 0) {
    const failure = sshFailure(target.host, jumps);
    return { status: "unreachable", exitCode: prepared.code, output: tail(prepared.output.includes(failure) ? prepared.output : `${prepared.output}${failure}\n`) };
  }
  if (files.length) {
    // 经跳板机时 scp 用不了（目标上没有控制台公钥），打成 tar 流穿过两跳再解开。
    const copied = jumpFor(target.host, jumps)
      ? await exec(
          "sh",
          ["-c", `${["tar", "-cf", "-", ...files.flatMap((file) => ["-C", path.dirname(file), path.basename(file)])].map(shq).join(" ")} | ${["ssh", ...sshArgs(target.host, `tar -xpf - -C ${shq(dir)}`, jumps)].map(shq).join(" ")}`],
          null,
          deadline,
        )
      : await exec("scp", [...sshOptions(), "-q", "-p", ...files, `${remote}:${dir}/`], null, deadline);
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
  const ran = await sshExec(exec, target.host, "bash -s", `${header}${task.script}\n`, deadline, undefined, jumps);
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
function portLines(ports: HwPort[]): string[] {
  return (["cpu", "memory", "pcie", "drive", "net"] as const).map((group) => `  ${portSummary(ports, group)}`);
}

export async function collectInventory(
  task: Pick<RemoteTask, "projectId" | "timeoutSec" | "inventorySources" | "inventorySettings" | "inventoryKinds">,
  target: Pick<TaskTarget, "serverId" | "host" | "sn">,
  exec: Exec,
  redfish: RedfishFactory = redfishGetter,
): Promise<{ status: TaskTargetStatus; exitCode: number | null; output: string }> {
  const deadline = Date.now() + task.timeoutSec * 1000;
  const sources = task.inventorySources || ["os", "bmc"];
  const kinds = task.inventoryKinds?.length ? task.inventoryKinds : undefined;
  // 只采几类时：结果里只留这几类（加整机、主板），存的时候其余类别从上一次带过来；任务输出也只列这几类。
  const pick = (components: HwComponent[]) => (kinds ? components.filter((item) => kinds.includes(item.kind) || item.kind === "system" || item.kind === "board") : components);
  const only = kinds ? { kinds: [...kinds] } : {};
  const row = getAsset(target.serverId);
  const lines: string[] = [];
  let ok = 0;
  let tried = 0;
  let reached = false;

  if (sources.includes("os")) {
    if (!target.host) {
      lines.push("系统内：找不到系统地址，跳过");
    } else {
      tried++;
      const ran = await sshExec(exec, target.host, "bash -s", INVENTORY_SCRIPT, deadline, INVENTORY_OUTPUT_LIMIT);
      if (ran.timedOut) {
        lines.push(`系统内（${target.host}）：超过 ${task.timeoutSec} 秒，已中止`);
      } else if (ran.code === 255 || !ran.output.includes("===PXEINV ")) {
        const failure = sshFailure(target.host);
        lines.push(`系统内：${failure}`, ...(ran.output.includes(failure) ? [] : [tail(ran.output).trim()]));
      } else {
        reached = true;
        const parsed = parseOsInventory(ran.output);
        const components = pick(parsed.components);
        const saved = await saveInventory({
          serverId: target.serverId,
          projectId: task.projectId,
          sn: target.sn,
          source: "os",
          at: new Date().toISOString(),
          host: target.host,
          components,
          ...only,
          warnings: parsed.warnings,
          ...(parsed.topology ? { topology: parsed.topology } : {}),
          ports: parsed.ports,
        });
        ok++;
        lines.push(`系统内（${target.host}）：`, ...summarizeComponents(components).map((line) => `  ${line}`), ...portLines(parsed.ports), ...changeLines(saved.changes), ...parsed.warnings.map((line) => `  提示：${line}`));
      }
    }
  }

  if (sources.includes("bmc")) {
    const accounts = row ? assetBmcAccounts(row) : [];
    if (!row?.bmcIp) {
      lines.push("BMC：还没有 BMC 地址，跳过");
    } else if (!accounts.length) {
      lines.push(`BMC（${row.bmcIp}）：资产里没有 BMC 账号密码，跳过`);
    } else {
      tried++;
      let done = false;
      let failure = "";
      for (const account of accounts) {
        try {
          const raw = await withDeadline(crawlRedfish(redfish(row.bmcIp, account.user, account.password), { kinds }), deadline, "读 Redfish ");
          reached = true;
          const components = pick(redfishComponents(raw));
          // 只采几类时没读插槽，盘位插槽沿用上一次的（saveInventory 里换）。
          const ports = kinds ? [] : redfishPorts(raw);
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
            ports,
            ...only,
          });
          ok++;
          done = true;
          lines.push(`BMC（${row.bmcIp}）：`, ...summarizeComponents(components).map((line) => `  ${line}`), ...(kinds ? [] : portLines(ports)), ...changeLines(saved.changes), ...warnings.map((line) => `  提示：${line}`));
          break;
        } catch (error) {
          failure = error instanceof Error ? error.message : "读取失败";
          if (!(error instanceof RedfishAuthError)) break;
        }
      }
      if (!done) lines.push(`BMC（${row.bmcIp}）：${failure}`);
    }
  }

  if (task.inventorySettings?.length && row && Date.now() < deadline) {
    const settings = await withDeadline(collectSettings(row, task.inventorySettings), deadline, `读${task.inventorySettings.map((item) => BMC_SETTING_LABEL[item]).join("、")}`).catch((error: unknown) => ({
      ok: 0,
      tried: task.inventorySettings!.length,
      lines: [`BMC、BIOS 设置：${error instanceof Error ? error.message : "读取失败"}`],
    }));
    ok += settings.ok;
    tried += settings.tried;
    if (settings.ok) reached = true;
    lines.push(...settings.lines);
  }

  const output = tail(`${lines.filter(Boolean).join("\n")}\n`);
  if (ok > 0 && ok === tried) return { status: "ok", exitCode: 0, output };
  if (Date.now() >= deadline) return { status: "timeout", exitCode: null, output };
  return { status: ok > 0 || reached ? "failed" : "unreachable", exitCode: null, output };
}

/** 手动查一台机器所有光模块的收发光：SSH 进系统跑 mlxlink / ethtool -m，存下这一次的读数。 */
export async function queryOptics(assetId: string, exec: Exec = defaultExec, context: HostContext = hostContext()): Promise<OpticsReading> {
  const row = getAsset(assetId);
  if (!row) throw new Error("资产不存在");
  const { host } = resolveAssetHost(row, context);
  if (!host) throw new Error(`${row.sn} 找不到系统地址，查不了光模块。收发光只能在系统里读`);
  const ran = await sshExec(exec, host, "bash -s", OPTICS_SCRIPT, Date.now() + 120_000, INVENTORY_OUTPUT_LIMIT);
  if (ran.timedOut) throw new Error(`${row.sn}（${host}）查询超过 2 分钟，已中止`);
  if (ran.code === 255 || !ran.output.includes("===PXEOPT end===")) {
    throw new Error(sshFailure(host));
  }
  return saveOptics({ serverId: row.id, at: new Date().toISOString(), host, ports: parseOptics(ran.output) });
}

/**
 * 在系统里经本机 IPMI 接口（KCS，/dev/ipmi0）让 BMC 冷重启，BMC 网口不通也能用。
 * 退出码 3：没有 ipmitool；4：没有 IPMI 设备。
 */
export const BMC_RESET_SCRIPT = `
if ! command -v ipmitool >/dev/null 2>&1; then echo "系统里没有 ipmitool"; exit 3; fi
if [ ! -e /dev/ipmi0 ] && [ ! -e /dev/ipmi/0 ] && [ ! -e /dev/ipmidev/0 ]; then
  modprobe ipmi_devintf 2>/dev/null; modprobe ipmi_si 2>/dev/null; sleep 2
fi
if [ ! -e /dev/ipmi0 ] && [ ! -e /dev/ipmi/0 ] && [ ! -e /dev/ipmidev/0 ]; then echo "系统里没有 IPMI 设备（/dev/ipmi0）"; exit 4; fi
out=$(timeout 60 ipmitool mc reset cold 2>&1); code=$?
echo "$out"
case "$out" in *"Sent cold reset"*) exit 0 ;; esac
exit $code
`;

/**
 * 重启 BMC（冷重启，不影响服务器系统）。outband 用资产上的 BMC 账号经网口发 IPMI；
 * inband SSH 进系统，用系统里的 ipmitool 经本机接口发，BMC 网络不通或密码不对时用这个。
 */
export async function resetBmc(
  assetId: string,
  via: BmcResetVia,
  deps: { exec?: Exec; ipmi?: IpmiExec; context?: HostContext; host?: string } = {},
): Promise<{ message: string }> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("资产不存在");
  const after = "BMC 要 1~3 分钟才能重新连上，这期间网页、远程控制台和 Redfish 都连不上";
  if (via === "outband") {
    if (!asset.bmcIp) throw new Error(`${asset.sn} 还没有 BMC 地址，带外重启不了，可以试带内`);
    const accounts = assetBmcAccounts(asset);
    if (!accounts.length) throw new Error(`${asset.sn} 没有 BMC 账号密码，带外重启不了，可以试带内`);
    const ipmi = deps.ipmi || defaultIpmiExec;
    const { account, result } = await firstWorkingAccount(asset.bmcIp, accounts, ipmi);
    if (!account) {
      throw new Error(
        ipmiFailure(result.stderr) === "denied" ? `${asset.sn} 的 BMC ${asset.bmcIp} 不接受资产里的账号密码，可以试带内` : `${asset.sn} 的 BMC ${asset.bmcIp} 没有回应，可以试带内`,
      );
    }
    await bmcColdReset(asset.bmcIp, account.user, account.password, ipmi);
    return { message: `${asset.sn}：已让 BMC ${asset.bmcIp} 冷重启（带外）。${after}` };
  }
  if (via !== "inband") throw new Error("不支持的重启方式");
  const host = deps.host || resolveAssetHost(asset, deps.context || hostContext()).host;
  if (!host) throw new Error(`${asset.sn} 找不到系统地址，带内重启不了`);
  const ran = await sshExec(deps.exec || defaultExec, host, "bash -s", BMC_RESET_SCRIPT, Date.now() + 90_000);
  const said = ran.output.trim().split("\n").slice(-3).join(" ").slice(0, 200);
  if (ran.timedOut) throw new Error(`${asset.sn}（${host}）超过 90 秒没完成，已中止`);
  if (ran.code === 255) throw new Error(sshFailure(host));
  if (ran.code === 3) throw new Error(`${asset.sn}（${host}）的系统里没有 ipmitool，先装上（apt/yum install ipmitool）`);
  if (ran.code !== 0) throw new Error(`${asset.sn}（${host}）重启 BMC 失败${said ? `：${said}` : ""}`);
  return { message: `${asset.sn}：已经系统 ${host} 让 BMC 冷重启（带内）。${after}` };
}

/** 设 BMC 时区任务的参数：只留给了的项，检查格式。 */
function cleanClock(input: ClockChange | undefined): ClockChange {
  const clock: ClockChange = {};
  if (input?.offset) {
    if (!validOffset(input.offset)) throw new Error(`时区要写成 +08:00 这样，「${input.offset}」不对`);
    clock.offset = input.offset;
  }
  if (typeof input?.ntpEnabled === "boolean") clock.ntpEnabled = input.ntpEnabled;
  if (Array.isArray(input?.ntpServers)) clock.ntpServers = input.ntpServers.map((item) => String(item).trim()).filter(Boolean);
  if (!Object.keys(clock).length) throw new Error("没有要改的：时区和 NTP 至少改一项");
  if (clock.ntpEnabled && clock.ntpServers && !clock.ntpServers.length) throw new Error("打开 NTP 要填至少一个服务器");
  return clock;
}

function clockName(clock: ClockChange): string {
  const parts = [
    clock.offset ? `时区 UTC${clock.offset}` : "",
    clock.ntpEnabled === undefined ? "" : clock.ntpEnabled ? "开 NTP" : "关 NTP",
    clock.ntpServers?.length ? clock.ntpServers.join(", ") : "",
  ].filter(Boolean);
  return `设 BMC ${parts.join("，")}`.slice(0, 80);
}

/** 设 BMC 时区任务里的一台：经 Redfish 改，成功后在资产记录里记一笔。 */
async function clockTarget(task: RemoteTask, target: TaskTarget): Promise<Pick<TaskTarget, "status" | "exitCode" | "output">> {
  const asset = getAsset(target.serverId);
  if (!asset) return { status: "failed", exitCode: null, output: "资产已经删掉了\n" };
  try {
    const done = await changeClock(await openSession(asset), task.bmcClock || {});
    addEvent(asset.id, "bmc", `${done.join("，")}（任务「${task.name}」）`, "批量任务");
    return { status: "ok", exitCode: 0, output: `${done.join("\n")}\n` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "修改失败";
    return { status: /连不上|没有回应|不接受/.test(message) ? "unreachable" : "failed", exitCode: null, output: `${message}\n` };
  }
}

/** 收集 BMC 日志任务里的一台：打成 tar.gz 放在这个任务的目录里，任务页可以下载。 */
async function logsTarget(task: RemoteTask, target: TaskTarget): Promise<Pick<TaskTarget, "status" | "exitCode" | "output">> {
  const asset = getAsset(target.serverId);
  if (!asset) return { status: "failed", exitCode: null, output: "资产已经删掉了\n" };
  const bundle = await buildLogBundle(asset, taskBundleDir(task.id), {}, task.bmcLogs);
  const size = fs.statSync(bundle.file).size;
  const output = `${bundle.lines.join("\n")}\n打包：${bundle.name}（${Math.max(1, Math.round(size / 1024))} KB）\n`;
  return { status: bundle.empty ? "unreachable" : "ok", exitCode: bundle.empty ? null : 0, output };
}

/** BMC 用户任务里的一台：经 IPMI 改，成功后在资产记录里记一笔。 */
async function userTarget(task: RemoteTask, target: TaskTarget): Promise<Pick<TaskTarget, "status" | "exitCode" | "output">> {
  const asset = getAsset(target.serverId);
  if (!asset) return { status: "failed", exitCode: null, output: "资产已经删掉了\n" };
  if (!task.bmcUser?.password && (task.bmcUser?.action === "ensure" || task.bmcUser?.action === "password")) {
    return { status: "failed", exitCode: null, output: "任务里的密码已经清掉了（任务被中断后重跑？），重新发起\n" };
  }
  try {
    const done = await applyUserChange(asset, task.bmcUser!, "批量任务");
    addEvent(asset.id, "bmc", `${done.join("，")}（任务「${task.name}」）`, "批量任务");
    return { status: "ok", exitCode: 0, output: `${done.join("\n")}\n` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "修改失败";
    return { status: /没有回应|不接受|还没有 BMC|没有 BMC 账号/.test(message) ? "unreachable" : "failed", exitCode: null, output: `${message}\n` };
  }
}

/** 接口和页面拿到的任务：去掉 BMC 用户任务里的密码。 */
export function publicTask(task: RemoteTask): RemoteTask {
  if (!task.bmcUser?.password) return task;
  return { ...task, bmcUser: { ...task.bmcUser, password: "" } };
}

/** 等 BMC 重启回来：每 10 秒探一次，最多等 10 分钟。 */
const BMC_BACK_POLL_MS = 10_000;
const BMC_BACK_WAIT_MS = 10 * 60_000;
/** 这么久都没断开过，就当它重启得很快、两次探测之间已经回来了。 */
const BMC_DOWN_GRACE_MS = 3 * 60_000;
/** IPMI 回来以后再等 Redfish 这么久，还不行就不等了（有的 BMC 关了 Redfish）。 */
const REDFISH_GRACE_MS = 5 * 60_000;

export interface BmcBackDeps {
  ipmi?: IpmiExec;
  redfish?: RedfishFactory;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * 冷重启发出去以后等 BMC 回来：先看到它断开（真的在重启），再等 IPMI 能登录、Redfish 能读，网页和远程控制台也就能用了。
 * 容器里没有 ping，用 IPMI 和 Redfish 探，比 ping 通更能说明 BMC 起来了。onProgress 每次探完报一句现在的情况。
 */
export async function waitBmcBack(
  assetId: string,
  onProgress: (text: string) => void = () => {},
  deps: BmcBackDeps = {},
): Promise<{ ok: boolean; message: string }> {
  const asset = getAsset(assetId);
  if (!asset) return { ok: false, message: "资产已经删掉了" };
  const accounts = assetBmcAccounts(asset);
  if (!asset.bmcIp || !accounts.length) return { ok: true, message: `${asset.bmcIp ? "没有 BMC 账号密码" : "没有 BMC 地址"}，没法确认 BMC 重启回来，过几分钟自己看一下` };
  const ipmi = deps.ipmi || defaultIpmiExec;
  const redfish = deps.redfish || ((host, user, password) => redfishGetter(host, user, password, 10_000));
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now || Date.now;
  const start = now();
  const elapsed = () => `${Math.round((now() - start) / 1000)} 秒`;
  let downAt = 0;
  let ipmiBackAt = 0;
  while (now() - start < BMC_BACK_WAIT_MS) {
    await sleep(BMC_BACK_POLL_MS);
    const { account } = await firstWorkingAccount(asset.bmcIp, accounts, ipmi).catch(() => ({ account: null }));
    if (!account) {
      downAt ||= now();
      ipmiBackAt = 0;
      onProgress(`BMC 已断开，在重启，等它回来（已等 ${elapsed()}）`);
      continue;
    }
    if (!downAt && now() - start < BMC_DOWN_GRACE_MS) {
      onProgress(`BMC 还没断开，等它开始重启（已等 ${elapsed()}）`);
      continue;
    }
    ipmiBackAt ||= now();
    const ready = await redfish(asset.bmcIp, account.user, account.password)("/redfish/v1")
      .then((doc) => Boolean(doc))
      .catch((error) => error instanceof RedfishAuthError);
    const took = `用了 ${elapsed()}`;
    const note = downAt ? "" : "（一直没探到断开，可能两次探测之间已经重启完了）";
    if (ready) return { ok: true, message: `BMC ${asset.bmcIp} 已经重启回来，IPMI 和 Redfish 都能连上，${took}${note}` };
    if (now() - ipmiBackAt >= REDFISH_GRACE_MS) return { ok: true, message: `BMC ${asset.bmcIp} 的 IPMI 回来了，Redfish 等了 5 分钟还连不上，${took}${note}。网页打不开的话再等等或看 BMC 设置` };
    onProgress(`IPMI 回来了，等 Redfish（网页、远程控制台）起来（已等 ${elapsed()}）`);
  }
  return { ok: false, message: `等了 ${BMC_BACK_WAIT_MS / 60_000} 分钟 BMC ${asset.bmcIp} 还没回来，${downAt ? "断开以后一直没连上" : "一直连不上"}，看一下 BMC 网络或去机房看看` };
}

/**
 * 重启 BMC 任务里的一台：发出重启后在资产记录里记一笔，然后等 BMC 回来才算这台完成。
 * 等的这段不占并发：发完重启就把等待交给 waits，worker 接着去发下一台。
 */
async function resetBmcTarget(
  task: RemoteTask,
  target: TaskTarget,
  exec: Exec,
  waits: Promise<void>[],
  bmcBack: BmcBackDeps,
): Promise<Pick<TaskTarget, "status" | "exitCode" | "output"> | null> {
  const via = task.bmcReset || "outband";
  let sent: string;
  try {
    sent = (await resetBmc(target.serverId, via, { exec, ipmi: bmcBack.ipmi, host: via === "inband" ? target.host : undefined })).message;
    addEvent(target.serverId, "bmc", `重启 BMC（${via === "inband" ? "带内" : "带外"}，任务「${task.name}」）`, "批量任务");
  } catch (error) {
    const message = error instanceof Error ? error.message : "重启 BMC 失败";
    return { status: /SSH 登录|没有回应|找不到系统地址/.test(message) ? "unreachable" : "failed", exitCode: null, output: `${message}\n` };
  }
  target.output = `${sent}\n等 BMC 重启回来…\n`;
  writeTask(task);
  waits.push(
    waitBmcBack(
      target.serverId,
      (text) => {
        target.output = `${sent}\n${text}\n`;
        writeTask(task);
      },
      bmcBack,
    ).then((back) => {
      Object.assign(target, { status: back.ok ? "ok" : "unreachable", exitCode: back.ok ? 0 : null, output: `${sent}\n${back.message}\n`, finishedAt: new Date().toISOString() });
      if (back.ok) addEvent(target.serverId, "bmc", `BMC 重启完成：${back.message}`, "批量任务");
      writeTask(task);
    }),
  );
  return null;
}

/** 在独立进程里跑完一个任务，每台机器状态变化时写回任务文件。 */
export async function runTask(id: string, exec: Exec = defaultExec, redfish: RedfishFactory = redfishGetter, bmcBack: BmcBackDeps = {}): Promise<RemoteTask> {
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
  // 重启 BMC：发完重启后等它回来，等的这些在最后一起收。
  const waits: Promise<void>[] = [];
  const worker = async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      target.status = "running";
      target.startedAt = new Date().toISOString();
      writeTask(task);
      try {
        if (task.kind === "bmc-reset") {
          const result = await resetBmcTarget(task, target, exec, waits, bmcBack);
          // null：重启已发出，在后台等它回来，这台的结果和结束时间到时候再写。
          if (!result) continue;
          Object.assign(target, result);
          target.finishedAt = new Date().toISOString();
          writeTask(task);
          continue;
        }
        Object.assign(
          target,
          task.kind === "inventory"
            ? await collectInventory(task, target, exec, redfish)
              : task.kind === "bmc-clock"
                ? await clockTarget(task, target)
                : task.kind === "bmc-logs"
                  ? await logsTarget(task, target)
                  : task.kind === "bmc-user"
                    ? await userTarget(task, target)
                    : await runOnHost(task, target, files, exec),
        );
      } catch (error) {
        target.status = "failed";
        target.output = error instanceof Error ? error.message : "执行失败";
      }
      target.finishedAt = new Date().toISOString();
      writeTask(task);
    }
  };
  if (task.kind === "bmc-logs") cleanupBundles();
  await Promise.all(Array.from({ length: Math.min(task.concurrency, queue.length) }, worker));
  await Promise.all(waits);
  task.status = "done";
  task.finishedAt = new Date().toISOString();
  if (task.bmcUser?.password) task.bmcUser = { ...task.bmcUser, password: "" };
  writeTask(task);
  return task;
}
