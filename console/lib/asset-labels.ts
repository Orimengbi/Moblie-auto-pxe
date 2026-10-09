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

type BadgeVariant = "default" | "outline" | "destructive" | "success" | "warning" | "info";

/** 状态标签的配色：正常绿色，进行中蓝/黄，出问题红色，不再用的灰色。各列表共用。 */
export function partStatusVariant(status: PartStatus): BadgeVariant {
  return status === "stock" ? "success" : status === "installed" ? "info" : status === "faulty" ? "destructive" : status === "rma" || status === "removed" ? "warning" : "outline";
}

export const ASSET_STATUS_VARIANT: Record<AssetStatus, BadgeVariant> = {
  stock: "outline",
  racked: "info",
  installing: "info",
  pending: "warning",
  active: "success",
  repair: "destructive",
  offline: "outline",
  scrapped: "outline",
};

/** 总览页状态分布条用的颜色（Tailwind 类名）。 */
export const ASSET_STATUS_COLOR: Record<AssetStatus, string> = {
  stock: "bg-chart-5",
  racked: "bg-info",
  installing: "bg-chart-4",
  pending: "bg-warning",
  active: "bg-success",
  repair: "bg-destructive",
  offline: "bg-muted-foreground/40",
  scrapped: "bg-muted-foreground/20",
};

export const TICKET_STATUS_VARIANT: Record<TicketStatus, BadgeVariant> = {
  open: "warning",
  processing: "info",
  waiting: "outline",
  resolved: "success",
  closed: "outline",
};

export function priorityVariant(priority: TicketPriority): BadgeVariant {
  return priority === "urgent" ? "destructive" : priority === "high" ? "warning" : "outline";
}

export function taskTargetVariant(status: string): BadgeVariant {
  return status === "ok" ? "success" : status === "running" ? "info" : status === "pending" ? "outline" : "destructive";
}

export const FLOOR_ITEM_KINDS: Record<FloorItemKind, string> = {
  pillar: "柱子",
  ac: "空调",
  power: "配电柜",
  blocked: "不可用位置",
  other: "其他",
};
