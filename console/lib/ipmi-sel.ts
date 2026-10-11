import { assetBmcAccounts } from "./assets.ts";
import type { LogEntryView, LogServiceView } from "./bmc-redfish.ts";
import { defaultIpmiExec, firstWorkingAccount, ipmiFailure, type IpmiExec } from "./ipmi-remote.ts";
import type { Asset } from "./types.ts";

/**
 * 经 IPMI 直读 SEL。AMI 的 Redfish「IPMI SEL」会漏条目：6QM8N72HMA0041 实际 108 条，Redfish 只给 42 条，
 * PS6 的 AC lost 一条都没有；ipmitool sel elist 和 BMC 网页一致。
 */

/** 哪些事件算告警。只看事件文字，ipmitool 不给级别。 */
const CRITICAL = /AC lost|Failure detected|failure|Fault|Uncorrectable|Non-recoverable|Critical|IERR|Thermal ?Trip|Machine Check|Power off|Power down|Configuration error|Lost|Watchdog|Bus Uncorrectable|Unrecoverable/i;
const WARNING = /Inactive|Predictive|Non-critical|Correctable|Degraded|Redundancy Degraded|Throttl|Limit Exceeded|Transition to (Off Line|Degraded|Non-Critical)|Out of range|Upper|Lower/i;

export function selSeverity(event: string, direction: string): string {
  if (/deasserted/i.test(direction)) return "OK";
  if (CRITICAL.test(event)) return "Critical";
  if (WARNING.test(event)) return "Warning";
  return "OK";
}

/** 09/11/26 + 07:39:12 UTC → ISO。认不出（如 Pre-Init）给空。 */
function selTime(date: string, time: string): string {
  const d = date.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  const t = time.match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (!d || !t) return "";
  const year = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
  const at = Date.UTC(year, Number(d[1]) - 1, Number(d[2]), Number(t[1]), Number(t[2]), Number(t[3]));
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}

/**
 * 解析 ipmitool sel elist（不带 -v）。一行：`  4f | 10/10/26 | 02:51:46 UTC | Power Supply PS6_Status | Power Supply AC lost | Asserted`。
 * 告警之后同一传感器同一事件出现 Deasserted 的，告警标成已恢复。返回顺序同输入（旧的在前）。
 */
export function parseSelElist(text: string): LogEntryView[] {
  const out: LogEntryView[] = [];
  const open = new Map<string, LogEntryView>();
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || !/^[0-9a-f]+$/i.test(cells[0])) continue;
    const [rawId, date, time, sensor, event, direction = "", ...rest] = cells;
    const id = String(parseInt(rawId, 16));
    const severity = selSeverity(event, direction);
    const entry: LogEntryView = {
      id,
      created: selTime(date, time),
      severity,
      message: [sensor, event, direction, ...rest].filter(Boolean).join(" · "),
      messageId: "",
      entryType: "SEL",
      sensor,
      device: "",
      resolution: "",
      resolved: severity === "OK" ? null : false,
    };
    const key = `${sensor}\u0000${event}`;
    if (/deasserted/i.test(direction)) {
      const alert = open.get(key);
      if (alert) alert.resolved = true;
      open.delete(key);
    } else if (severity !== "OK") open.set(key, entry);
    out.push(entry);
  }
  return out;
}

/** sel info 里的条数。 */
export function parseSelCount(text: string): number | null {
  const match = text.match(/^\s*Entries\s*:\s*(\d+)/m);
  return match ? Number(match[1]) : null;
}

/** 日志列表里代表「IPMI 直读 SEL」的路径，不是 Redfish 路径。 */
export const IPMI_SEL_PATH = "ipmi:sel";

/** 读 SEL 不带 -v，整份 SEL 一千多条也要给够时间。 */
const quietExec: IpmiExec = (host, user, password, args) => defaultIpmiExec(host, user, password, args, 90_000, false);

export async function withAccount<T>(asset: Asset, exec: IpmiExec, work: (account: { user: string; password: string }) => Promise<T>): Promise<T> {
  if (!asset.bmcIp) throw new Error(`${asset.sn} 还没有 BMC 地址`);
  const accounts = assetBmcAccounts(asset);
  if (!accounts.length) throw new Error(`${asset.sn} 没有 BMC 账号密码`);
  const { account, result } = await firstWorkingAccount(asset.bmcIp, accounts, exec);
  if (!account) throw new Error(ipmiFailure(result.stderr) === "denied" ? `BMC ${asset.bmcIp} 不接受资产里的账号密码` : `BMC ${asset.bmcIp} 的 IPMI 没有回应`);
  return work(account);
}

export async function ipmiSelService(asset: Asset, exec: IpmiExec = quietExec): Promise<LogServiceView> {
  const count = await withAccount(asset, exec, async (account) => parseSelCount((await exec(asset.bmcIp, account.user, account.password, ["sel", "info"])).stdout));
  return { id: "ipmi-sel", path: IPMI_SEL_PATH, name: "SEL（IPMI 直读）", owner: "manager", source: "", count, canClear: true };
}

export async function readIpmiSel(asset: Asset, exec: IpmiExec = quietExec): Promise<LogEntryView[]> {
  return withAccount(asset, exec, async (account) => {
    const result = await exec(asset.bmcIp, account.user, account.password, ["sel", "elist"]);
    if (result.code !== 0) throw new Error(`读 SEL 失败：${(result.stderr || result.stdout).trim().slice(0, 160)}`);
    return parseSelElist(result.stdout);
  });
}

export async function clearIpmiSel(asset: Asset, exec: IpmiExec = quietExec): Promise<void> {
  await withAccount(asset, exec, async (account) => {
    const result = await exec(asset.bmcIp, account.user, account.password, ["sel", "clear"]);
    if (result.code !== 0) throw new Error(`清空 SEL 失败：${(result.stderr || result.stdout).trim().slice(0, 160)}`);
  });
}
