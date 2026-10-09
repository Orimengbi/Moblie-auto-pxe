import type { AlertSeverity, AlertSource, AlertStatus, Asset, AssetStatus, FloorItemKind, AssetType, Customer, PartKind, PartStatus, TagSettings, TicketKind, TicketPriority, TicketStatus } from "./types.ts";

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

export const PART_KINDS: Record<PartKind, string> = {
  cpu: "CPU",
  memory: "内存",
  disk: "硬盘",
  gpu: "GPU",
  nic: "网卡",
  transceiver: "光模块",
  psu: "电源",
  board: "主板 / 背板",
  fan: "风扇",
  cable: "线缆",
  other: "其他",
};

export const PART_STATUS: Record<PartStatus, string> = {
  stock: "在库",
  installed: "已装机",
  removed: "已拆下",
  faulty: "待返修",
  rma: "返修中",
  scrapped: "报废",
};

export const TICKET_KINDS: Record<TicketKind, string> = {
  fault: "故障",
  repair: "维修",
  change: "变更",
  other: "其他",
};

export const TICKET_PRIORITY: Record<TicketPriority, string> = {
  low: "低",
  normal: "中",
  high: "高",
  urgent: "紧急",
};

export const TICKET_STATUS: Record<TicketStatus, string> = {
  open: "待处理",
  processing: "处理中",
  waiting: "等待中",
  resolved: "已解决",
  closed: "已关闭",
};

/** 还没解决的工单状态。 */
export const OPEN_TICKET_STATUS: TicketStatus[] = ["open", "processing", "waiting"];

export const ALERT_SEVERITY: Record<AlertSeverity, string> = { critical: "严重", warning: "警告" };
export const ALERT_STATUS: Record<AlertStatus, string> = { active: "告警中", acked: "已确认", resolved: "已恢复" };
export const ALERT_SOURCE: Record<AlertSource, string> = { sensor: "传感器", sel: "BMC 事件", bmc: "BMC", gpu: "GPU", xid: "GPU Xid", disk: "硬盘", snmp: "SNMP", port: "端口" };

/** 状态颜色：success 正常，info 进行中，warning 要留意，error 出问题，neutral 不再用或未开始。各列表共用。 */
export type Tone = "neutral" | "primary" | "success" | "info" | "warning" | "error";

export function partStatusTone(status: PartStatus): Tone {
  return status === "stock" ? "success" : status === "installed" ? "info" : status === "faulty" ? "error" : status === "rma" || status === "removed" ? "warning" : "neutral";
}

export function priorityTone(priority: TicketPriority): Tone {
  return priority === "urgent" ? "error" : priority === "high" ? "warning" : "neutral";
}

export function taskTargetTone(status: string): Tone {
  return status === "ok" ? "success" : status === "running" ? "info" : status === "pending" ? "neutral" : "error";
}

export const ASSET_STATUS_TONE: Record<AssetStatus, Tone> = {
  stock: "neutral",
  racked: "info",
  installing: "primary",
  pending: "warning",
  active: "success",
  repair: "error",
  offline: "neutral",
  scrapped: "neutral",
};

export const TICKET_STATUS_TONE: Record<TicketStatus, Tone> = {
  open: "warning",
  processing: "info",
  waiting: "neutral",
  resolved: "success",
  closed: "neutral",
};

export const ALERT_SEVERITY_TONE: Record<AlertSeverity, Tone> = { critical: "error", warning: "warning" };

export const FLOOR_ITEM_KINDS: Record<FloorItemKind, string> = {
  pillar: "柱子",
  ac: "空调",
  power: "配电柜",
  blocked: "不可用位置",
  other: "其他",
};
