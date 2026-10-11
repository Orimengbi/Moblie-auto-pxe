import { isHgxFirmware } from "./asset-labels.ts";
import { listAssets } from "./assets.ts";
import { loadSnapshot, type FirmwareItem } from "./bmc-redfish.ts";

/**
 * 固件版本总览：把每台机器上次读到的固件清单（侧边栏 BMC 页、批量采集「固件版本」存下的）按机型汇总，
 * 每个部件有哪些版本、各几台，哪个是大多数机器用的，哪些机器跟大多数不一样。只读本地存的，不连 BMC。
 */

export interface FleetMachine {
  id: string;
  tag: string;
  sn: string;
  hostname: string;
  bmcIp: string;
  /** 上次读固件的时间；没读过是空。 */
  readAt: string;
}

/** 机器用它在 FleetModel.machines 里的序号表示，几百台 × 几十项时页面数据小很多。 */
export interface FleetVersion {
  version: string;
  machines: number[];
}

export interface FleetComponent {
  id: string;
  hgx: boolean;
  /** 按台数从多到少；第一个就是大多数机器用的。 */
  versions: FleetVersion[];
  /** 读过固件、但清单里没有这一项的机器。 */
  missing: number[];
}

export interface FleetModel {
  model: string;
  machines: FleetMachine[];
  components: FleetComponent[];
  /** 每台机器跟大多数不一样的部件（含缺的），只列有的。 */
  outliers: { machine: number; items: { id: string; version: string; common: string }[] }[];
}

/** 按部件汇总一组机器的固件清单。纯函数，测试直接用。 */
export function summarizeFirmware(model: string, machines: FleetMachine[], inventories: Map<string, FirmwareItem[]>): FleetModel {
  const byComponent = new Map<string, Map<string, number[]>>();
  const read = machines.map((machine, index) => index).filter((index) => inventories.has(machines[index].id));
  for (const index of read) {
    for (const item of inventories.get(machines[index].id)!) {
      const versions = byComponent.get(item.id) || new Map<string, number[]>();
      versions.set(item.version, [...(versions.get(item.version) || []), index]);
      byComponent.set(item.id, versions);
    }
  }
  const components: FleetComponent[] = [...byComponent.entries()]
    .map(([id, versions]) => {
      const list = [...versions.entries()].map(([version, members]) => ({ version, machines: members })).sort((a, b) => b.machines.length - a.machines.length || a.version.localeCompare(b.version));
      const has = new Set(list.flatMap((item) => item.machines));
      return { id, hgx: isHgxFirmware(id), versions: list, missing: read.filter((index) => !has.has(index)) };
    })
    .sort((a, b) => Number(b.hgx) - Number(a.hgx) || a.id.localeCompare(b.id, "en", { numeric: true }));
  const outliers = read
    .map((index) => {
      const own = new Map(inventories.get(machines[index].id)!.map((item) => [item.id, item.version]));
      const items = components
        .filter((component) => component.versions.length > 1 || component.missing.length)
        .map((component) => ({ id: component.id, version: own.has(component.id) ? own.get(component.id)! : null, common: component.versions[0].version }))
        .filter((item) => item.version !== item.common)
        .map((item) => ({ id: item.id, version: item.version ?? "（没有）", common: item.common }));
      return { machine: index, items };
    })
    .filter((row) => row.items.length)
    .sort((a, b) => b.items.length - a.items.length);
  return { model, machines, components, outliers };
}

/** 所有服务器按型号分组汇总，台数多的型号在前。 */
export function firmwareFleet(): FleetModel[] {
  const groups = new Map<string, FleetMachine[]>();
  const inventories = new Map<string, FirmwareItem[]>();
  for (const asset of listAssets()) {
    if (asset.type !== "server") continue;
    const snapshot = loadSnapshot<FirmwareItem[]>(asset.id, "firmware");
    if (snapshot) inventories.set(asset.id, snapshot.data);
    const model = asset.model || "（没填型号）";
    groups.set(model, [...(groups.get(model) || []), { id: asset.id, tag: asset.tag, sn: asset.sn, hostname: asset.hostname, bmcIp: asset.bmcIp, readAt: snapshot?.readAt || "" }]);
  }
  return [...groups.entries()].map(([model, machines]) => summarizeFirmware(model, machines, inventories)).sort((a, b) => b.machines.length - a.machines.length || a.model.localeCompare(b.model));
}
