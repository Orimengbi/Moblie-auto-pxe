import type { Asset, AssetStatus, AssetType, Customer, TagSettings } from "./types.ts";

/** 页面和服务端共用的名称。这个文件不碰数据库，客户端组件可以直接引用。 */
export const ASSET_TYPES: Record<AssetType, string> = {
  server: "服务器",
  switch: "网络设备",
  pdu: "PDU",
  other: "其他",
};

export const ASSET_STATUS: Record<AssetStatus, string> = {
  stock: "入库",
  racked: "上架",
  installing: "装机中",
  pending: "待交付",
  active: "在用",
  repair: "维修中",
  offline: "下架",
  scrapped: "报废",
};

export type WarrantyState = "none" | "expired" | "expiring" | "valid";

export const WARRANTY_LABEL: Record<WarrantyState, string> = {
  none: "未填",
  expired: "已过保",
  expiring: "90 天内到期",
  valid: "在保",
};

export const TAG_TOKEN = /\{(type|customer|seq|year|sn)(?::(\d{1,2}))?\}/g;

/** 按编号规则算一台资产的编号；手动指定过就用手动的。设置页的预览也用它。 */
export function renderTag(asset: Pick<Asset, "seq" | "type" | "sn" | "customerId" | "createdAt" | "tagOverride">, settings: TagSettings, customers: Map<string, Customer>): string {
  if (asset.tagOverride) return asset.tagOverride;
  return settings.template.replace(TAG_TOKEN, (_, name: string, width?: string) => {
    if (name === "type") return settings.typeCodes[asset.type] || asset.type;
    if (name === "customer") return (asset.customerId && customers.get(asset.customerId)?.code) || settings.noCustomer;
    if (name === "year") return asset.createdAt.slice(0, 4);
    if (name === "sn") return asset.sn;
    return String(asset.seq).padStart(Number(width || 0), "0");
  });
}
