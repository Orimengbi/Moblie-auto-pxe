import { applyFindings, type Finding } from "./alerts.ts";
import { getAsset, listAssets } from "./assets.ts";
import { diffComponents } from "./inventory.ts";
import { getMonitorState, saveMonitorState } from "./monitor.ts";
import { defaultSnmpExec, getSnmpProfile, readNetworkDevice, readPortStatus, type SnmpExec } from "./snmp.ts";
import { latestInventory, listInventory, saveInventory } from "./store.ts";
import type { Asset, InventorySnapshot, MonitorSettings, MonitorState, NetPort } from "./types.ts";

/**
 * 网络设备：按资产上的管理地址和 SNMP 凭据采集，LLDP 对端对到我们的资产；监控端口掉线和错包增长。
 */

function normMac(value: string): string {
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, "");
  return hex.length === 12 ? hex.match(/../g)!.join(":") : "";
}

/** 主机名（不带域名）和 MAC → 资产。MAC 来自 BMC、装机网卡和最近一次系统内采集的网卡。 */
function neighborIndex(exclude: string): { byName: Map<string, Asset>; byMac: Map<string, Asset> } {
  const byName = new Map<string, Asset>();
  const byMac = new Map<string, Asset>();
  for (const asset of listAssets()) {
    if (asset.id === exclude) continue;
    if (asset.hostname) byName.set(asset.hostname.toLowerCase().split(".")[0], asset);
    for (const mac of [asset.bmcMac, asset.bootMac]) if (normMac(mac)) byMac.set(normMac(mac), asset);
    const snapshot = latestInventory(asset.id, "os");
    if (snapshot) {
      for (const item of snapshot.components) if (item.kind === "nic" && normMac(String(item.attrs.mac || ""))) byMac.set(normMac(String(item.attrs.mac)), asset);
      for (const port of snapshot.ports || []) if (port.mac && normMac(port.mac)) byMac.set(normMac(port.mac), asset);
    }
    // 交换机之间的 LLDP 报的是对方的 sysName，上次采集的 sysName 也认。
    const snmp = latestInventory(asset.id, "snmp");
    if (snmp?.system?.name) byName.set(snmp.system.name.toLowerCase().split(".")[0], asset);
  }
  return { byName, byMac };
}

export function matchNeighbors(ports: NetPort[], selfId: string): void {
  const index = neighborIndex(selfId);
  for (const port of ports) {
    if (!port.neighbor) continue;
    const name = port.neighbor.sysName.toLowerCase().split(".")[0];
    const asset = (name && index.byName.get(name)) || index.byMac.get(normMac(port.neighbor.chassisId)) || index.byMac.get(normMac(port.neighbor.portId));
    if (asset) {
      port.neighbor.assetId = asset.id;
      port.neighbor.assetTag = asset.tag;
    }
  }
}

function deviceTarget(asset: Asset) {
  if (!asset.mgmtIp) throw new Error(`${asset.tag} 没有填管理地址`);
  const profile = asset.snmpProfileId ? getSnmpProfile(asset.snmpProfileId) : null;
  if (!profile) throw new Error(`${asset.tag} 没有选 SNMP 凭据`);
  return { host: asset.mgmtIp, profile };
}

/** 对端、端口描述这些「接线」信息，用来判断要不要存一份新的采集。 */
function wiring(ports: NetPort[] | undefined): string {
  return JSON.stringify((ports || []).map((port) => [port.name, port.alias, port.neighbor?.sysName || "", port.neighbor?.portId || "", port.transceiver?.sn || ""]));
}

/**
 * 采集一台网络设备。force 时总是存；定时采集只有部件或接线变了才存，免得 30 份历史全是一样的。
 * 返回最新的那份（没变时是上一份）。
 */
export async function collectNetwork(assetId: string, options: { force?: boolean; exec?: SnmpExec } = {}): Promise<InventorySnapshot> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("资产不存在");
  const { host, profile } = deviceTarget(asset);
  const reading = await readNetworkDevice(host, profile, options.exec || defaultSnmpExec);
  matchNeighbors(reading.ports, asset.id);
  const previous = latestInventory(asset.id, "snmp");
  if (!options.force && previous && !diffComponents(previous.components, reading.components).length && wiring(previous.netPorts) === wiring(reading.ports)) return previous;
  return saveInventory({
    serverId: asset.id,
    projectId: "",
    sn: asset.sn,
    source: "snmp",
    at: new Date().toISOString(),
    host,
    components: reading.components,
    warnings: reading.warnings,
    netPorts: reading.ports,
    system: reading.system,
  });
}

/** 服务器在哪些交换机的哪个口上（从各交换机最近一次采集的 LLDP 看）。 */
export function uplinksOf(assetId: string): { switchId: string; switchTag: string; port: string; remotePort: string; oper: string }[] {
  const out: { switchId: string; switchTag: string; port: string; remotePort: string; oper: string }[] = [];
  for (const asset of listAssets()) {
    if (asset.id === assetId || !asset.mgmtIp) continue;
    const snapshot = latestInventory(asset.id, "snmp");
    for (const port of snapshot?.netPorts || []) {
      if (port.neighbor?.assetId === assetId) out.push({ switchId: asset.id, switchTag: asset.tag, port: port.name, remotePort: port.neighbor.portDesc || port.neighbor.portId, oper: port.oper });
    }
  }
  return out;
}

/**
 * 监控一台网络设备：读端口状态。曾经 up 过、管理上没关的口现在不 up 就报（有对端的算严重）；错包比上次多就报。
 * 连续连不上报「设备连不上」。
 */
export async function checkNetwork(asset: Asset, settings: MonitorSettings, exec: SnmpExec = defaultSnmpExec): Promise<MonitorState> {
  const state = getMonitorState(asset.id);
  state.bmcAt = new Date().toISOString();
  const findings: Finding[] = [];
  let ports: NetPort[];
  try {
    const { host, profile } = deviceTarget(asset);
    ports = await readPortStatus(host, profile, exec);
  } catch (error) {
    state.bmcOk = false;
    state.bmcError = error instanceof Error ? error.message : "读取失败";
    state.bmcFailures += 1;
    if (asset.mgmtIp && asset.snmpProfileId && state.bmcFailures >= settings.bmcFailuresToAlert) {
      findings.push({ key: "snmp:down", source: "snmp", severity: "warning", title: "网络设备连不上", detail: `${state.bmcError}，连续 ${state.bmcFailures} 次` });
    }
    saveMonitorState(state);
    applyFindings(asset.id, findings, ["snmp:"]);
    return state;
  }
  state.bmcOk = true;
  state.bmcError = "";
  state.bmcFailures = 0;
  const neighbors = new Map((latestInventory(asset.id, "snmp")?.netPorts || []).map((port) => [port.name, port.neighbor ? port.neighbor.assetTag || port.neighbor.sysName : ""]));
  const before = new Map(state.ports.map((port) => [port.name, port]));
  state.ports = ports
    .filter((port) => port.physical)
    .map((port) => {
      const old = before.get(port.name);
      // wasUp 记在 oper 里：曾经 up 过的口一直标着，直到在交换机上关掉或者重置基线。
      const wasUp = port.oper === "up" || Boolean(old && (old.oper === "up" || old.oper === "was-up"));
      const neighbor = neighbors.get(port.name) || old?.neighbor || "";
      if (port.admin === "up" && wasUp && port.oper !== "up") {
        findings.push({
          key: `port:${port.name}`,
          source: "port",
          severity: neighbor ? "critical" : "warning",
          title: `端口 ${port.name} 掉线${neighbor ? `（对端 ${neighbor}）` : ""}`,
          detail: `状态 ${port.oper}${port.alias ? `，描述「${port.alias}」` : ""}。有意拔掉的话在交换机上 shutdown 这个口，或在资产「端口」页重置基线`,
        });
      }
      for (const [field, label] of [
        ["inErrors", "收"],
        ["outErrors", "发"],
      ] as const) {
        const now = port[field];
        const then = old?.[field];
        if (now !== null && then !== null && then !== undefined && now > then) {
          findings.push({ key: `porterr:${port.name}:${field}`, source: "port", severity: "warning", title: `端口 ${port.name} ${label}错包增加 ${now - then}`, detail: `上次 ${then}，这次 ${now}${neighbor ? `，对端 ${neighbor}` : ""}` });
        }
      }
      const oper = port.oper === "up" ? "up" : port.admin === "up" && wasUp ? "was-up" : port.oper;
      return { name: port.name, admin: port.admin, oper, inErrors: port.inErrors, outErrors: port.outErrors, neighbor };
    });
  saveMonitorState(state);
  applyFindings(asset.id, findings, ["snmp:", "port:", "porterr:"]);
  return state;
}

/** 重置端口基线：现在不 up 的口不再当作「应该 up」，相关告警下次检查自动恢复。 */
export function resetPortBaseline(assetId: string): MonitorState {
  const state = getMonitorState(assetId);
  state.ports = state.ports.map((port) => (port.oper === "was-up" ? { ...port, oper: "down" } : port));
  saveMonitorState(state);
  applyFindings(assetId, [], ["port:"]);
  return state;
}

/** 网络设备侧边栏用：最近一次采集，和历史次数。 */
export function networkView(assetId: string): { snapshot: InventorySnapshot | null; history: number } {
  return { snapshot: latestInventory(assetId, "snmp"), history: listInventory(assetId).filter((item) => item.source === "snmp").length };
}
