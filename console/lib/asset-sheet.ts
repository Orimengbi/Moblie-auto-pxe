import { ASSET_STATUS, ASSET_TYPES } from "./asset-labels.ts";
import type { Asset, AssetStatus, AssetType, Customer, Datacenter, Rack, Site } from "./types.ts";

/**
 * 资产的 Excel：模板、导出和导入用同一套列。导入时按序列号对上已有资产，只改填了的格子；
 * 「编号」列只在导出时给人看，导入不读（要改编号填「手动编号」）。导出不带密码。
 */

export type SheetField =
  | "sn"
  | "type"
  | "status"
  | "vendor"
  | "model"
  | "customer"
  | "owner"
  | "location"
  | "datacenter"
  | "site"
  | "rack"
  | "uStart"
  | "uHeight"
  | "tagOverride"
  | "bmcMac"
  | "bmcIp"
  | "bmcUser"
  | "bmcPassword"
  | "bmcFallbackUser"
  | "bmcFallbackPassword"
  | "hostname"
  | "osAddress"
  | "osNetmask"
  | "bootMac"
  | "mgmtIp"
  | "snmpProfile"
  | "purchaseSupplier"
  | "purchaseOrder"
  | "purchaseDate"
  | "purchasePrice"
  | "warrantyVendor"
  | "warrantyLevel"
  | "warrantyStart"
  | "warrantyEnd"
  | "note";

export const SHEET_COLUMNS: { field: SheetField; header: string; aliases: string[] }[] = [
  { field: "sn", header: "序列号", aliases: ["sn", "serial", "序列号*", "整机序列号"] },
  { field: "type", header: "类型", aliases: ["资产类型", "设备类型"] },
  { field: "status", header: "状态", aliases: ["资产状态", "生命周期"] },
  { field: "vendor", header: "厂商", aliases: ["品牌", "vendor"] },
  { field: "model", header: "型号", aliases: ["model", "机型"] },
  { field: "customer", header: "归属客户", aliases: ["客户", "归属", "客户代码"] },
  { field: "owner", header: "负责人", aliases: [] },
  { field: "datacenter", header: "数据中心", aliases: ["数据中心代码", "idc", "dc"] },
  { field: "site", header: "机房", aliases: ["机房代码"] },
  { field: "rack", header: "机柜", aliases: ["机柜号", "rack"] },
  { field: "uStart", header: "起始U", aliases: ["u位", "起始u位", "ustart"] },
  { field: "uHeight", header: "占用U", aliases: ["高度u", "u数", "uheight"] },
  { field: "location", header: "位置备注", aliases: ["位置", "机房位置"] },
  { field: "tagOverride", header: "手动编号", aliases: ["资产编号（手动）"] },
  { field: "bmcMac", header: "BMC MAC", aliases: ["ipmimac", "bmcmac地址", "ipmimac地址"] },
  { field: "bmcIp", header: "BMC 地址", aliases: ["bmcip", "ipmi地址", "ipmiip"] },
  { field: "bmcUser", header: "BMC 账号", aliases: ["bmc用户", "ipmi账号", "ipmi用户"] },
  { field: "bmcPassword", header: "BMC 密码", aliases: ["ipmi密码"] },
  { field: "bmcFallbackUser", header: "BMC 备用账号", aliases: ["备用账号"] },
  { field: "bmcFallbackPassword", header: "BMC 备用密码", aliases: ["备用密码"] },
  { field: "hostname", header: "主机名", aliases: ["hostname"] },
  { field: "osAddress", header: "系统地址", aliases: ["系统ip", "业务ip", "业务地址"] },
  { field: "osNetmask", header: "系统掩码", aliases: ["业务掩码"] },
  { field: "bootMac", header: "装机网卡 MAC", aliases: ["pxemac", "装机mac"] },
  { field: "mgmtIp", header: "管理地址", aliases: ["管理ip", "管理口ip", "mgmtip"] },
  { field: "snmpProfile", header: "SNMP 凭据", aliases: ["snmp"] },
  { field: "purchaseSupplier", header: "供应商", aliases: [] },
  { field: "purchaseOrder", header: "采购单号", aliases: ["合同号", "采购合同", "订单号"] },
  { field: "purchaseDate", header: "采购日期", aliases: ["购买日期"] },
  { field: "purchasePrice", header: "价格", aliases: ["采购价格", "金额"] },
  { field: "warrantyVendor", header: "保修方", aliases: ["维保方"] },
  { field: "warrantyLevel", header: "服务级别", aliases: ["保修级别", "维保级别"] },
  { field: "warrantyStart", header: "保修开始", aliases: ["维保开始", "保修起始"] },
  { field: "warrantyEnd", header: "保修到期", aliases: ["维保到期", "保修结束", "过保日期"] },
  { field: "note", header: "备注", aliases: [] },
];

const DATE_FIELDS: SheetField[] = ["purchaseDate", "warrantyStart", "warrantyEnd"];

function headerKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s*＊]+/g, "");
}

const HEADER_MAP = new Map<string, SheetField>();
for (const column of SHEET_COLUMNS) for (const name of [column.header, ...column.aliases]) HEADER_MAP.set(headerKey(name), column.field);

export type SheetCells = Partial<Record<SheetField, string>>;

/** Excel 的日期序列号（1900 系统）换成 YYYY-MM-DD。 */
function serialDate(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400_000).toISOString().slice(0, 10);
}

/** 认 2026-10-08、2026/10/8、2026.10.8、2026年10月8日 和 Excel 日期；认不出就原样交给校验报错。 */
export function normalizeDate(value: unknown): string {
  if (typeof value === "number" && value > 20000 && value < 80000) return serialDate(value);
  const text = String(value ?? "").trim();
  const match = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(text);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return text;
}

/** 读表头（前 8 行里有「序列号」的那行），一行一台。整行空的跳过。行号按 Excel 里的算。 */
export function parseAssetTable(rows: unknown[][]): { records: { row: number; cells: SheetCells }[]; error?: string; ignored: string[] } {
  let headerAt = -1;
  let fields: (SheetField | undefined)[] = [];
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const mapped = (rows[i] || []).map((cell) => HEADER_MAP.get(headerKey(cell)));
    // 序列号可以不填（只填 BMC 地址和账号密码，导入时从 BMC 读），表头有其中一个就行。
    if (mapped.includes("sn") || mapped.includes("bmcIp")) {
      headerAt = i;
      fields = mapped;
      break;
    }
  }
  if (headerAt < 0) return { records: [], ignored: [], error: "没有找到表头。表头那一行要有「序列号」或「BMC 地址」，可以先下载模板对照。" };
  const ignored = (rows[headerAt] || [])
    .map((cell, index) => (fields[index] ? "" : String(cell ?? "").trim()))
    .filter((name) => name && name !== "编号");
  const records: { row: number; cells: SheetCells }[] = [];
  for (let i = headerAt + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((cell) => String(cell ?? "").trim())) continue;
    const cells: SheetCells = {};
    fields.forEach((field, column) => {
      if (!field) return;
      const raw = row[column];
      const value = DATE_FIELDS.includes(field) ? normalizeDate(raw) : String(raw ?? "").trim();
      if (value) cells[field] = value;
    });
    records.push({ row: i + 1, cells });
  }
  if (!records.length) return { records, ignored, error: "表头下面没有数据" };
  return { records, ignored };
}

function pick<T extends string>(labels: Record<T, string>, value: string, extra: Record<string, T> = {}): T | null {
  const key = headerKey(value);
  for (const [code, label] of Object.entries(labels) as [T, string][]) if (key === code || key === headerKey(label)) return code;
  return extra[key] ?? null;
}

export function parseType(value: string): AssetType | null {
  return pick(ASSET_TYPES, value, { 交换机: "switch", 网络: "switch", 路由器: "switch", 防火墙: "switch", 主机: "server", 整机: "server", gpu服务器: "server" });
}

export function parseStatus(value: string): AssetStatus | null {
  return pick(ASSET_STATUS, value, { 库存: "stock", 已上架: "racked", 使用中: "active", 在线: "active", 维修: "repair", 故障: "repair", 已下架: "offline", 已报废: "scrapped" });
}

/** 导出：表头一行，一台一行，最前面加「编号」列给人看。不带密码。 */
export function assetsToRows(
  assets: Asset[],
  customers: Customer[],
  racks: Rack[] = [],
  sites: Site[] = [],
  snmpProfiles: { id: string; name: string }[] = [],
  datacenters: Datacenter[] = [],
): string[][] {
  const datacenterById = new Map(datacenters.map((item) => [item.id, item]));
  const profileById = new Map(snmpProfiles.map((item) => [item.id, item.name]));
  const byId = new Map(customers.map((item) => [item.id, item]));
  const rackById = new Map(racks.map((item) => [item.id, item]));
  const siteById = new Map(sites.map((item) => [item.id, item]));
  const columns = SHEET_COLUMNS.filter((column) => column.field !== "bmcPassword" && column.field !== "bmcFallbackPassword");
  return [
    ["编号", ...columns.map((column) => column.header)],
    ...assets.map((asset) => [
      asset.tag,
      ...columns.map((column) => {
        if (column.field === "type") return ASSET_TYPES[asset.type];
        if (column.field === "status") return ASSET_STATUS[asset.status];
        if (column.field === "customer") return asset.customerId ? byId.get(asset.customerId)?.code || "" : "";
        const rack = asset.rackId ? rackById.get(asset.rackId) : undefined;
        if (column.field === "site") return rack ? siteById.get(rack.siteId)?.code || "" : "";
        if (column.field === "datacenter") return rack ? datacenterById.get(siteById.get(rack.siteId)?.datacenterId || "")?.code || "" : "";
        if (column.field === "rack") return rack?.name || "";
        if (column.field === "uStart") return asset.uStart ? String(asset.uStart) : "";
        if (column.field === "uHeight") return String(asset.uHeight);
        if (column.field === "snmpProfile") return asset.snmpProfileId ? profileById.get(asset.snmpProfileId) || "" : "";
        return String(asset[column.field as keyof Asset] ?? "");
      }),
    ]),
  ];
}

/** 导入模板和导出表里要下拉选的列：类型、状态按固定选项，数据中心、机房按现有的代码（也认名称，所以只提醒不拦）。 */
export function assetDropdowns(datacenters: Pick<Datacenter, "code">[], sites: Pick<Site, "code">[]): { header: string; values: string[]; strict: boolean }[] {
  const header = (field: SheetField) => SHEET_COLUMNS.find((column) => column.field === field)!.header;
  return [
    { header: header("type"), values: Object.values(ASSET_TYPES), strict: true },
    { header: header("status"), values: Object.values(ASSET_STATUS), strict: true },
    { header: header("datacenter"), values: datacenters.map((item) => item.code), strict: false },
    { header: header("site"), values: sites.map((item) => item.code), strict: false },
  ];
}

export const TEMPLATE_EXAMPLE: Partial<Record<SheetField, string>> = {
  sn: "SNABC001",
  type: "服务器",
  status: "在用",
  vendor: "Gigabyte",
  model: "G894-SD3",
  customer: "示例：客户代码或名称，留空不改，写「自有」清空",
  datacenter: "数据中心代码，可以不写",
  site: "机房代码",
  rack: "A01",
  uStart: "10",
  uHeight: "2",
  bmcMac: "aa:bb:cc:dd:ee:10",
  bmcIp: "192.168.100.21",
  bmcUser: "admin",
  bmcPassword: "示例，导入前删掉这一行",
  purchaseDate: "2026-01-15",
  warrantyStart: "2026-01-15",
  warrantyEnd: "2029-01-14",
  warrantyLevel: "3 年 7×24 4 小时",
};
