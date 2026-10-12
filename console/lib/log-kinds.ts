/** 下载 BMC 日志时能选的类型。页面也要用，这里不能引 Node 模块。 */

/** IPMI 直读的几样。 */
export const IPMI_LOG_PARTS = [
  { key: "ipmi:sel", label: "SEL 事件日志（IPMI 直读）" },
  { key: "ipmi:sdr", label: "传感器读数" },
  { key: "ipmi:fru", label: "FRU（序列号、型号）" },
  { key: "ipmi:info", label: "BMC 信息和机箱状态" },
] as const;

/** Redfish 日志按来源分的大类，批量收集时按这个选（各台的日志清单可能不一样）。 */
export const REDFISH_LOG_GROUPS = [
  { key: "rf:bmc", label: "BMC 日志（审计、事件、Redfish SEL…）" },
  { key: "rf:host", label: "主机日志（BIOS、SMI、Crashdump、CPER…）" },
  { key: "rf:hgx-board", label: "HGX 底板日志（GPU、NVSwitch 告警）" },
  { key: "rf:hgx-bmc", label: "HGX BMC 日志" },
  { key: "rf:other", label: "其他 Redfish 日志" },
] as const;

/** 默认勾的：排障最常用的。 */
export const DEFAULT_LOG_KINDS = ["ipmi:sel", "ipmi:sdr", "rf:bmc", "rf:hgx-board"];

/** 一份 Redfish 日志属于哪个大类。source 是 HGX_BMC_0 这类附带的 Manager/System 名，主 BMC、主系统的为空。 */
export function redfishGroup(service: { owner: "manager" | "system"; source: string }): string {
  if (!service.source) return service.owner === "manager" ? "rf:bmc" : "rf:host";
  if (/^HGX_Baseboard/i.test(service.source)) return "rf:hgx-board";
  if (/^HGX_BMC/i.test(service.source)) return "rf:hgx-bmc";
  return "rf:other";
}

/** 单台下载时可以精确到某一份 Redfish 日志：rf:svc:<路径>。 */
export function serviceKey(path: string): string {
  return `rf:svc:${path}`;
}

/** 这份 Redfish 日志选没选：选了它所在的大类，或者选了它本身。 */
export function serviceSelected(selection: Set<string>, service: { path: string; owner: "manager" | "system"; source: string }): boolean {
  return selection.has(redfishGroup(service)) || selection.has(serviceKey(service.path));
}

/** 检查页面传来的选择。 */
export function cleanLogKinds(input: unknown): string[] {
  const list = (Array.isArray(input) ? input : String(input || "").split(",")).map((item) => String(item).trim()).filter(Boolean);
  const known = new Set<string>([...IPMI_LOG_PARTS.map((item) => item.key), ...REDFISH_LOG_GROUPS.map((item) => item.key)]);
  const kept = [...new Set(list.filter((item) => known.has(item) || /^rf:svc:\/redfish\/v1\/(Managers|Systems)\/[^/]+\/LogServices\/[^/?#]+$/.test(item)))];
  if (!kept.length) throw new Error("至少选一种日志");
  return kept.slice(0, 100);
}

/** 任务名、审计里用的一句话。 */
export function describeLogKinds(kinds: string[]): string {
  const labels: Record<string, string> = {
    "ipmi:sel": "SEL",
    "ipmi:sdr": "传感器",
    "ipmi:fru": "FRU",
    "ipmi:info": "BMC 信息",
    "rf:bmc": "BMC 日志",
    "rf:host": "主机日志",
    "rf:hgx-board": "HGX 底板",
    "rf:hgx-bmc": "HGX BMC",
    "rf:other": "其他",
  };
  const named = kinds.filter((kind) => labels[kind]).map((kind) => labels[kind]);
  const single = kinds.filter((kind) => kind.startsWith("rf:svc:")).length;
  return [...named, ...(single ? [`${single} 份 Redfish 日志`] : [])].join("、");
}
