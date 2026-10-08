import { getCustomer, listAssets, listCustomers, publicAsset, warrantyState } from "./assets.ts";
import { listRacks, listSites, placeLabel } from "./racks.ts";
import { hostContext, resolveAssetHost, type HostContext } from "./remote.ts";
import { getBaseline, inventoryStatus, listProjects, listServers } from "./store.ts";
import type { Asset, Baseline, InventoryStatus, PublicAsset, TaskHostSource } from "./types.ts";

/** 资产列表和详情页用的一行：资产本身加上归属客户、保修状态、系统地址、硬件采集情况、最近一次装机。 */
export type AssetRow = PublicAsset & {
  customerName: string;
  /** 「机房代码 / 机柜号 / U10-U17」，没放进机柜是空的。 */
  place: string;
  siteId: string;
  warranty: ReturnType<typeof warrantyState>;
  host: string;
  hostSource: TaskHostSource;
  inventory: InventoryStatus;
  batch: { projectId: string; name: string; rowId: string; osName: string; installed: string } | null;
};

/**
 * light：机房页、资产下拉框这类只要编号、状态、位置的地方用，不算系统地址、不读硬件采集，资产多时快很多。
 */
export function assetRows(assets: Asset[] = listAssets(), context?: HostContext, options: { light?: boolean } = {}): AssetRow[] {
  const light = Boolean(options.light);
  const hosts = light ? null : context || hostContext();
  const customers = new Map(listCustomers().map((item) => [item.id, item.name]));
  const projects = new Map(listProjects().map((item) => [item.id, item.name]));
  const latest = new Map<string, ReturnType<typeof listServers>[number]>();
  for (const row of listServers()) {
    const seen = latest.get(row.assetId);
    if (!seen || row.updatedAt > seen.updatedAt) latest.set(row.assetId, row);
  }
  const baselines = new Map<string, Baseline | null>();
  const racks = new Map(listRacks().map((item) => [item.id, item]));
  const sites = new Map(listSites().map((item) => [item.id, item]));
  return assets.map((asset) => {
    const row = latest.get(asset.id);
    const found = hosts ? resolveAssetHost(asset, hosts) : { host: "", source: "" as const };
    // 硬件「符合基准」按这台最近一次装机批次的基准算。
    if (!light && row && !baselines.has(row.projectId)) baselines.set(row.projectId, getBaseline(row.projectId));
    return {
      ...publicAsset(asset),
      customerName: asset.customerId ? customers.get(asset.customerId) || "" : "",
      place: placeLabel(asset, racks, sites),
      siteId: (asset.rackId && racks.get(asset.rackId)?.siteId) || "",
      warranty: warrantyState(asset),
      host: found.host,
      hostSource: found.source,
      inventory: light ? { issues: null } : inventoryStatus(asset.id, row ? baselines.get(row.projectId) || null : null),
      batch: row ? { projectId: row.projectId, name: projects.get(row.projectId) || "", rowId: row.id, osName: row.osName, installed: row.installed } : null,
    };
  });
}

export function customerLabel(id: string | null): string {
  return id ? getCustomer(id)?.name || "" : "";
}
