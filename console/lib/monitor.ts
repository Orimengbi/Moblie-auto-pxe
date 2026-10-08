import fs from "node:fs";
import path from "node:path";
import { applyFindings, type Finding } from "./alerts.ts";
import { assetBmcAccounts } from "./assets.ts";
import { db, getSetting, putSetting } from "./db.ts";
import { defaultIpmiExec, firstWorkingAccount, ipmiFailure, type IpmiExec } from "./ipmi-remote.ts";
import { dataDir } from "./paths.ts";
import { markedSections } from "./sections.ts";
import type { Asset, AssetStatus, DiskHealth, GpuHealth, MonitorSettings, MonitorState, SelEntry, SensorReading } from "./types.ts";

/**
 * 监控：用 ipmitool 读 BMC 的传感器（sdr elist）和事件日志（sel elist），SSH 进系统查 GPU（nvidia-smi、Xid）和硬盘健康。
 * 结果存在 monitor_state，发现的问题交给 alerts.ts 开告警或自动恢复。这里只有解析和单台检查，定时跑在 monitor-runner.ts。
 */

export const DEFAULT_MONITOR: MonitorSettings = {
  enabled: true,
  bmcIntervalMin: 5,
  osIntervalMin: 30,
  statuses: ["active", "repair", "pending"],
  gpuTempWarn: 85,
  ignoreSensors: "",
  bmcFailuresToAlert: 2,
};

export function getMonitorSettings(): MonitorSettings {
  return { ...DEFAULT_MONITOR, ...getSetting<Partial<MonitorSettings>>("monitor") };
}

const STATUSES: AssetStatus[] = ["stock", "racked", "installing", "pending", "active", "repair", "offline", "scrapped"];

export function saveMonitorSettings(input: Partial<MonitorSettings>): MonitorSettings {
  const current = getMonitorSettings();
  const int = (value: unknown, fallback: number, min: number, max: number, label: string) => {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}需要是 ${min} 到 ${max} 的整数`);
    return n;
  };
  const statuses = input.statuses === undefined ? current.statuses : input.statuses.filter((status) => STATUSES.includes(status));
  const next: MonitorSettings = {
    enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
    bmcIntervalMin: int(input.bmcIntervalMin, current.bmcIntervalMin, 1, 1440, "BMC 检查间隔"),
    osIntervalMin: int(input.osIntervalMin, current.osIntervalMin, 0, 1440, "系统检查间隔"),
    statuses,
    gpuTempWarn: int(input.gpuTempWarn, current.gpuTempWarn, 40, 120, "GPU 温度告警线"),
    ignoreSensors: String(input.ignoreSensors ?? current.ignoreSensors).slice(0, 2000),
    bmcFailuresToAlert: int(input.bmcFailuresToAlert, current.bmcFailuresToAlert, 1, 20, "BMC 连不上几次报警"),
  };
  putSetting("monitor", next);
  return next;
}

// ---------- 解析 ----------

const CRITICAL_STATUS = new Set(["cr", "nr", "lcr", "ucr", "lnr", "unr"]);
const WARNING_STATUS = new Set(["nc", "lnc", "unc"]);
/** 离散传感器状态常是 ok，问题写在读数文字里。 */
const CRITICAL_TEXT = /failure detected|ac lost|power supply.*lost|uncorrectable|non-recoverable|fault|thermal trip|ierr|critical|not present.*expected/i;
const WARNING_TEXT = /predictive failure|degraded|non-critical|correctable/i;

export function sensorSeverity(status: string, reading: string): SensorReading["severity"] {
  const s = status.trim().toLowerCase();
  if (CRITICAL_STATUS.has(s)) return "critical";
  if (WARNING_STATUS.has(s)) return "warning";
  if (s === "ns") return null;
  if (CRITICAL_TEXT.test(reading) && !/no fault|fault deasserted/i.test(reading)) return "critical";
  if (WARNING_TEXT.test(reading) && !/uncorrectable/i.test(reading)) return "warning";
  return null;
}

/** `ipmitool sdr elist`：名称 | ID | 状态 | 实体 | 读数。 */
export function parseSdr(text: string): SensorReading[] {
  const out: SensorReading[] = [];
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || !cells[0]) continue;
    const [name, , status, , reading] = cells;
    if (!/^[a-z]{2,3}$/i.test(status)) continue;
    out.push({ name, status: status.toLowerCase(), reading, severity: sensorSeverity(status, reading) });
  }
  return out;
}

const SEL_CRITICAL = /critical|non-recoverable|uncorrectable|failure detected|ac lost|fault|ierr|machine check|thermal trip|bus fatal|bus uncorrectable|processor.*error|power off|watchdog/i;
const SEL_WARNING = /correctable|predictive|non-critical|degraded|presence detected.*deasserted|throttl/i;

export function selSeverity(event: string, direction: string): SelEntry["severity"] {
  if (/deasserted/i.test(direction)) return "info";
  const text = `${event} ${direction}`;
  if (SEL_CRITICAL.test(text)) return "critical";
  if (SEL_WARNING.test(text)) return "warning";
  return "info";
}

/** `ipmitool sel elist`：ID | 日期 | 时间 | 传感器 | 事件 | 方向。 */
export function parseSel(text: string): SelEntry[] {
  const out: SelEntry[] = [];
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || !/^[0-9a-f]+$/i.test(cells[0])) continue;
    const [id, date, time, sensor, event, direction = ""] = cells;
    out.push({ id: id.toLowerCase(), at: `${date} ${time}`, sensor, event, direction, severity: selSeverity(event, direction) });
  }
  return out;
}

/** 这次读到的 SEL 里，上次最后一条之后的才算新的。第一次查（没有上次）只记位置，不报旧的。 */
export function newSelEntries(entries: SelEntry[], last: string): SelEntry[] {
  if (!last) return [];
  const index = entries.findIndex((entry) => selKey(entry) === last);
  return index < 0 ? entries : entries.slice(index + 1);
}

export function selKey(entry: SelEntry): string {
  return `${entry.id}@${entry.at}`;
}

function wildcard(pattern: string): RegExp {
  return new RegExp(`^${pattern.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
}

export function ignoredSensor(name: string, ignore: string): boolean {
  return ignore
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .some((pattern) => wildcard(pattern).test(name));
}

export const OS_MONITOR_SCRIPT = (sinceEpoch: number) => `
echo "===PXEMON gpu"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,pci.bus_id,serial,temperature.gpu,ecc.errors.uncorrected.volatile.total --format=csv,noheader,nounits 2>&1
  echo "rc=$?"
else
  echo "none"
fi
echo "===PXEMON xid"
if command -v journalctl >/dev/null 2>&1; then
  journalctl -k --since "@${sinceEpoch}" --no-pager 2>/dev/null | grep -i "NVRM: Xid" | tail -n 100
else
  dmesg 2>/dev/null | grep -i "NVRM: Xid" | tail -n 100
fi
echo "===PXEMON disk"
if command -v smartctl >/dev/null 2>&1; then
  for d in $(lsblk -dno NAME,TYPE 2>/dev/null | awk '$2=="disk"{print $1}'); do
    r=$(smartctl -H /dev/$d 2>/dev/null | grep -iE "overall-health|SMART Health Status|Critical Warning" | head -n 1)
    echo "$d|$r"
  done
else
  echo "nosmartctl"
fi
echo "===PXEMON end"
`;

function section(text: string, name: string): string {
  return markedSections(text, "PXEMON").find((item) => item.head === name)?.body || "";
}

export function parseGpus(text: string): { gpus: GpuHealth[]; error: string; present: boolean } {
  const body = section(text, "gpu").trim();
  if (!body || body === "none") return { gpus: [], error: "", present: false };
  const lines = body.split("\n").filter((line) => !/^rc=/.test(line));
  const rc = /rc=(\d+)/.exec(body)?.[1];
  const gpus: GpuHealth[] = [];
  for (const line of lines) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length < 5 || !/^\d+$/.test(cells[0])) continue;
    const num = (value: string) => (/^\d+(\.\d+)?$/.test(value) ? Number(value) : null);
    gpus.push({ index: cells[0], bus: cells[1].toLowerCase(), serial: cells[2], temperature: num(cells[3]), eccUncorrected: num(cells[4]) });
  }
  const error = rc && rc !== "0" ? lines.join(" ").slice(0, 300) || `nvidia-smi 退出码 ${rc}` : "";
  return { gpus, error, present: true };
}

/** PCI 地址只比总线和设备号：nvidia-smi 写 00000000:1b:00.0，内核日志写 0000:1b:00。 */
function pciKey(bus: string): string {
  const match = /([0-9a-f]{2}):([0-9a-f]{2})(\.\d)?$/i.exec(bus.trim());
  return match ? `${match[1]}:${match[2]}`.toLowerCase() : bus.toLowerCase();
}

const XID_CRITICAL = new Set([48, 61, 62, 74, 79, 92, 94, 95, 119, 120, 140]);

export function parseXid(text: string): { bus: string; code: number; line: string }[] {
  const out: { bus: string; code: number; line: string }[] = [];
  for (const line of section(text, "xid").split("\n")) {
    const match = /Xid \(PCI:([0-9a-f:.]+)\):\s*(\d+)/i.exec(line);
    if (match) out.push({ bus: match[1].toLowerCase(), code: Number(match[2]), line: line.trim().slice(0, 300) });
  }
  return out;
}

export function parseDisks(text: string): DiskHealth[] {
  const out: DiskHealth[] = [];
  for (const line of section(text, "disk").split("\n")) {
    const [name, result = ""] = line.split("|");
    if (!name || name === "nosmartctl" || !result.trim()) continue;
    const value = result.split(":").slice(1).join(":").trim() || result.trim();
    const ok = /PASSED|OK|0x00\b|^0$/i.test(value);
    out.push({ name: name.trim(), health: value, ok });
  }
  return out;
}

// ---------- 状态 ----------

function emptyState(assetId: string): MonitorState {
  return { assetId, bmcAt: "", bmcOk: false, bmcError: "", bmcFailures: 0, sensors: [], selLast: "", selRecent: [], osAt: "", osOkAt: "", osOk: false, osError: "", gpus: [], disks: [], ports: [] };
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function getMonitorState(assetId: string): MonitorState {
  const row = db().prepare("SELECT * FROM monitor_state WHERE asset_id = ?").get(assetId);
  if (!row) return emptyState(assetId);
  return {
    assetId,
    bmcAt: String(row.bmc_at),
    bmcOk: Boolean(row.bmc_ok),
    bmcError: String(row.bmc_error),
    bmcFailures: Number(row.bmc_failures),
    sensors: parseJson(row.sensors, []),
    selLast: String(row.sel_last),
    selRecent: parseJson(row.sel_recent, []),
    osAt: String(row.os_at),
    osOkAt: String(row.os_ok_at ?? ""),
    osOk: Boolean(row.os_ok),
    osError: String(row.os_error),
    gpus: parseJson(row.gpus, []),
    disks: parseJson(row.disks, []),
    ports: parseJson(row.ports, []),
  };
}

export function listMonitorStates(): MonitorState[] {
  return db()
    .prepare("SELECT asset_id FROM monitor_state")
    .all()
    .map((row) => getMonitorState(String(row.asset_id)));
}

export function saveMonitorState(state: MonitorState): void {
  saveState(state);
}

function saveState(state: MonitorState): void {
  db()
    .prepare(
      `INSERT INTO monitor_state (asset_id, bmc_at, bmc_ok, bmc_error, bmc_failures, sensors, sel_last, sel_recent, os_at, os_ok, os_error, gpus, disks, ports, os_ok_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET bmc_at = excluded.bmc_at, bmc_ok = excluded.bmc_ok, bmc_error = excluded.bmc_error, bmc_failures = excluded.bmc_failures,
         sensors = excluded.sensors, sel_last = excluded.sel_last, sel_recent = excluded.sel_recent, os_at = excluded.os_at, os_ok = excluded.os_ok,
         os_error = excluded.os_error, gpus = excluded.gpus, disks = excluded.disks, ports = excluded.ports, os_ok_at = excluded.os_ok_at`,
    )
    .run(
      state.assetId,
      state.bmcAt,
      state.bmcOk ? 1 : 0,
      state.bmcError,
      state.bmcFailures,
      JSON.stringify(state.sensors),
      state.selLast,
      JSON.stringify(state.selRecent.slice(-100)),
      state.osAt,
      state.osOk ? 1 : 0,
      state.osError,
      JSON.stringify(state.gpus),
      JSON.stringify(state.disks),
      JSON.stringify(state.ports),
      state.osOkAt,
    );
}

// ---------- 单台检查 ----------

/** SDR 缓存：第一次 dump 下来，以后 -S 读本地文件，sdr elist 从几十秒降到几秒。 */
function sdrCachePath(assetId: string): string {
  return path.join(dataDir(), "monitor", `${assetId}.sdr`);
}

export type MonitorIpmiExec = (host: string, user: string, password: string, args: string[], timeoutMs?: number) => ReturnType<IpmiExec>;

/** 读 BMC：传感器和事件日志。返回这次发现的问题。 */
export async function checkBmc(asset: Asset, settings: MonitorSettings, exec: MonitorIpmiExec = defaultIpmiExec): Promise<MonitorState> {
  const state = getMonitorState(asset.id);
  const now = new Date().toISOString();
  state.bmcAt = now;
  const accounts = assetBmcAccounts(asset);
  const findings: Finding[] = [];
  const scopes: string[] = ["bmc:"];
  let account: { user: string; password: string } | null = null;
  let failure = "";
  if (!asset.bmcIp || !accounts.length) {
    failure = !asset.bmcIp ? "没有 BMC 地址" : "没有 BMC 账号密码";
  } else {
    const found = await firstWorkingAccount(asset.bmcIp, accounts, exec);
    account = found.account;
    if (!account) failure = ipmiFailure(found.result.stderr) === "denied" ? `BMC ${asset.bmcIp} 不接受资产里的账号密码` : `BMC ${asset.bmcIp} 没有回应`;
  }

  if (failure || !account) {
    state.bmcOk = false;
    state.bmcError = failure;
    state.bmcFailures += 1;
    if (asset.bmcIp && accounts.length && state.bmcFailures >= settings.bmcFailuresToAlert) {
      findings.push({ key: "bmc:down", source: "bmc", severity: "warning", title: "BMC 连不上", detail: `${failure}，连续 ${state.bmcFailures} 次` });
    }
    saveState(state);
    applyFindings(asset.id, findings, scopes);
    return state;
  }

  state.bmcOk = true;
  state.bmcError = "";
  state.bmcFailures = 0;
  const cache = sdrCachePath(asset.id);
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  if (!fs.existsSync(cache)) await exec(asset.bmcIp, account.user, account.password, ["sdr", "dump", cache], 120_000);
  let sdr = await exec(asset.bmcIp, account.user, account.password, fs.existsSync(cache) ? ["-S", cache, "sdr", "elist"] : ["sdr", "elist"], 120_000);
  if (sdr.code !== 0 && fs.existsSync(cache)) {
    // 缓存过期（BMC 升级、换了板子）：删掉直接读。
    fs.rmSync(cache, { force: true });
    sdr = await exec(asset.bmcIp, account.user, account.password, ["sdr", "elist"], 120_000);
  }
  if (sdr.stdout.trim()) {
    scopes.push("sensor:");
    state.sensors = parseSdr(sdr.stdout);
    for (const sensor of state.sensors) {
      if (!sensor.severity || ignoredSensor(sensor.name, settings.ignoreSensors)) continue;
      findings.push({ key: `sensor:${sensor.name}`, source: "sensor", severity: sensor.severity, title: `传感器 ${sensor.name} ${sensor.severity === "critical" ? "严重" : "异常"}`, detail: `状态 ${sensor.status}，读数 ${sensor.reading}` });
    }
  }

  const sel = await exec(asset.bmcIp, account.user, account.password, ["sel", "elist", "last", "100"], 60_000);
  if (sel.code === 0 || sel.stdout.trim()) {
    const entries = parseSel(sel.stdout);
    const fresh = newSelEntries(entries, state.selLast);
    if (entries.length) state.selLast = selKey(entries[entries.length - 1]);
    state.selRecent = [...state.selRecent, ...(state.selRecent.length ? fresh : entries)].slice(-100);
    for (const entry of fresh) {
      if (entry.severity === "info") continue;
      findings.push({
        key: `sel:${entry.sensor}:${entry.event}`,
        source: "sel",
        severity: entry.severity,
        title: `BMC 事件：${entry.sensor} ${entry.event}`,
        detail: `${entry.at} ${entry.sensor} | ${entry.event} | ${entry.direction}`,
        sticky: true,
      });
    }
  }
  saveState(state);
  applyFindings(asset.id, findings, scopes);
  return state;
}

/** SSH 进系统：GPU 数量、温度、不可纠正 ECC、Xid，硬盘 SMART。expectedGpus 是最近一次硬件采集里 NVIDIA GPU 的数量。 */
export async function checkOs(
  asset: Asset,
  host: string,
  expectedGpus: number,
  settings: MonitorSettings,
  ssh: (host: string, script: string) => Promise<{ code: number | null; output: string }>,
): Promise<MonitorState> {
  const state = getMonitorState(asset.id);
  // 从上次成功的那次往后查 Xid，SSH 失败的那几次之间的也不漏。
  const since = state.osOkAt ? Math.floor(Date.parse(state.osOkAt) / 1000) : Math.floor(Date.now() / 1000) - 3600;
  const startedAt = new Date().toISOString();
  state.osAt = startedAt;
  const ran = await ssh(host, OS_MONITOR_SCRIPT(since));
  if (ran.code === 255 || !ran.output.includes("===PXEMON end")) {
    state.osOk = false;
    state.osError = `SSH 登录 ${host} 失败`;
    saveState(state);
    return state;
  }
  state.osOk = true;
  state.osOkAt = startedAt;
  state.osError = "";
  const findings: Finding[] = [];
  const gpu = parseGpus(ran.output);
  state.gpus = gpu.gpus;
  if (gpu.present || expectedGpus) {
    if (gpu.error) findings.push({ key: "gpu:smi", source: "gpu", severity: "critical", title: "nvidia-smi 报错", detail: gpu.error });
    else if (expectedGpus && gpu.gpus.length < expectedGpus) {
      findings.push({ key: "gpu:count", source: "gpu", severity: "critical", title: `GPU 少了 ${expectedGpus - gpu.gpus.length} 张`, detail: `硬件采集记录 ${expectedGpus} 张，nvidia-smi 现在只看到 ${gpu.gpus.length} 张` });
    }
    for (const item of gpu.gpus) {
      if (item.temperature !== null && item.temperature >= settings.gpuTempWarn) {
        findings.push({ key: `gpu:temp:${item.bus}`, source: "gpu", severity: "warning", title: `GPU ${item.index} 温度 ${item.temperature}°C`, detail: `${item.bus} SN ${item.serial}，告警线 ${settings.gpuTempWarn}°C` });
      }
      if (item.eccUncorrected) {
        findings.push({ key: `gpu:ecc:${item.bus}`, source: "gpu", severity: "warning", title: `GPU ${item.index} 不可纠正 ECC ${item.eccUncorrected} 次`, detail: `${item.bus} SN ${item.serial}（volatile，重启后清零）` });
      }
    }
  }
  for (const xid of parseXid(ran.output)) {
    const item = gpu.gpus.find((g) => pciKey(g.bus) === pciKey(xid.bus));
    findings.push({
      key: `xid:${xid.bus}:${xid.code}`,
      source: "xid",
      severity: XID_CRITICAL.has(xid.code) ? "critical" : "warning",
      title: `GPU Xid ${xid.code}${item ? `（GPU ${item.index}）` : ""}`,
      detail: xid.line,
      sticky: true,
    });
  }
  state.disks = parseDisks(ran.output);
  for (const disk of state.disks) {
    if (!disk.ok) findings.push({ key: `disk:${disk.name}`, source: "disk", severity: "critical", title: `硬盘 ${disk.name} 健康检查没通过`, detail: disk.health });
  }
  saveState(state);
  applyFindings(asset.id, findings, ["gpu:", "disk:"]);
  return state;
}

/** 资产还在、而且状态在监控范围里。 */
export function monitored(asset: Asset | null, settings: MonitorSettings): asset is Asset {
  return Boolean(asset && settings.statuses.includes(asset.status));
}
