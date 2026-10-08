import { ASSET_STATUS, ASSET_TYPES, renderTag, TAG_TOKEN as TOKEN, type WarrantyState } from "./asset-labels.ts";
import { db, transaction, type SqlValue } from "./db.ts";
import { assertIpv4, normalizeMac, normalizeSn } from "./net.ts";
import type { Asset, AssetEvent, AssetStatus, AssetType, AuditEntry, Customer, PublicAsset, ServerRow, TagSettings } from "./types.ts";

export { ASSET_STATUS, ASSET_TYPES, renderTag } from "./asset-labels.ts";

export const DEFAULT_TAG_SETTINGS: TagSettings = {
  template: "RS-{type}-{seq:5}",
  noCustomer: "OWN",
  typeCodes: { server: "SRV", switch: "NET", pdu: "PDU", other: "OTH" },
};

// ---------- 设置 ----------

function getSetting<T>(key: string): T | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return null;
  try {
    return JSON.parse(String(row.value)) as T;
  } catch {
    return null;
  }
}

function putSetting(key: string, value: unknown): void {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

export function getTagSettings(): TagSettings {
  const saved = getSetting<Partial<TagSettings>>("asset.tag");
  return {
    template: saved?.template || DEFAULT_TAG_SETTINGS.template,
    noCustomer: saved?.noCustomer ?? DEFAULT_TAG_SETTINGS.noCustomer,
    typeCodes: { ...DEFAULT_TAG_SETTINGS.typeCodes, ...saved?.typeCodes },
  };
}

const CODE = /^[A-Za-z0-9_-]{0,16}$/;

function cleanTagSettings(input: Partial<TagSettings>): TagSettings {
  const template = String(input.template ?? "").trim();
  if (!template || template.length > 80) throw new Error("编号规则需要 1 到 80 个字符");
  const leftover = template.replace(TOKEN, "");
  if (/[{}]/.test(leftover)) throw new Error("编号规则里有认不出的 {…}。可用 {type} {customer} {seq} {seq:5} {year} {sn}");
  if (/[\s/\\]/.test(leftover)) throw new Error("编号规则里不能有空格和斜杠");
  if (!/\{(seq|sn)(:\d+)?\}/.test(template)) throw new Error("编号规则里要有 {seq} 或 {sn}，不然编号会重复");
  const noCustomer = String(input.noCustomer ?? "").trim();
  if (!CODE.test(noCustomer)) throw new Error("没有客户时的代码只能用字母、数字、- 和 _，最多 16 位");
  const typeCodes = { ...DEFAULT_TAG_SETTINGS.typeCodes };
  for (const type of Object.keys(typeCodes) as AssetType[]) {
    const code = String(input.typeCodes?.[type] ?? typeCodes[type]).trim();
    if (!code || !CODE.test(code)) throw new Error(`${ASSET_TYPES[type]}的类型代码只能用字母、数字、- 和 _，1 到 16 位`);
    typeCodes[type] = code;
  }
  return { template, noCustomer, typeCodes };
}

/** 改编号规则后所有资产的编号马上按新规则显示。手动指定过编号的不受影响。 */
export function saveTagSettings(input: Partial<TagSettings>): TagSettings {
  const settings = cleanTagSettings(input);
  const customers = new Map(listCustomers().map((item) => [item.id, item]));
  const seen = new Map<string, string>();
  for (const asset of rawAssets()) {
    const tag = renderTag(asset, settings, customers);
    const other = seen.get(tag);
    if (other) throw new Error(`按这个规则 ${other} 和 ${asset.sn} 的编号都是 ${tag}，加上 {seq} 或 {sn} 区分`);
    seen.set(tag, asset.sn);
  }
  putSetting("asset.tag", settings);
  return settings;
}

// ---------- 客户 ----------

function toCustomer(row: Record<string, SqlValue>): Customer {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    contact: String(row.contact),
    note: String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listCustomers(): Customer[] {
  return db().prepare("SELECT * FROM customers ORDER BY code").all().map(toCustomer);
}

export function getCustomer(id: string): Customer | null {
  const row = db().prepare("SELECT * FROM customers WHERE id = ?").get(id);
  return row ? toCustomer(row) : null;
}

export interface CustomerInput {
  code?: string;
  name?: string;
  contact?: string;
  note?: string;
}

function cleanCustomer(input: CustomerInput, id: string | null): Pick<Customer, "code" | "name" | "contact" | "note"> {
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,16}$/.test(code)) throw new Error("客户代码需要 1 到 16 位字母、数字、- 或 _");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 80) throw new Error("客户名称需要 1 到 80 个字符");
  const clash = db().prepare("SELECT name FROM customers WHERE code = ? AND id != ?").get(code, id || "");
  if (clash) throw new Error(`客户代码 ${code} 已经给了「${clash.name}」`);
  return { code, name, contact: String(input.contact ?? "").trim().slice(0, 200), note: String(input.note ?? "").trim().slice(0, 1000) };
}

export function createCustomer(input: CustomerInput): Customer {
  const clean = cleanCustomer(input, null);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db().prepare("INSERT INTO customers (id, code, name, contact, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, clean.code, clean.name, clean.contact, clean.note, now, now);
  return getCustomer(id)!;
}

export function updateCustomer(id: string, input: CustomerInput): Customer {
  if (!getCustomer(id)) throw new Error("客户不存在");
  const clean = cleanCustomer(input, id);
  db()
    .prepare("UPDATE customers SET code = ?, name = ?, contact = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(clean.code, clean.name, clean.contact, clean.note, new Date().toISOString(), id);
  return getCustomer(id)!;
}

export function deleteCustomer(id: string): void {
  const customer = getCustomer(id);
  if (!customer) throw new Error("客户不存在");
  const used = Number(db().prepare("SELECT COUNT(*) AS n FROM assets WHERE customer_id = ?").get(id)?.n ?? 0);
  if (used) throw new Error(`还有 ${used} 台资产归属「${customer.name}」，先把它们改到别的客户`);
  db().prepare("DELETE FROM customers WHERE id = ?").run(id);
}

// ---------- 资产 ----------

type ColumnKey = Exclude<keyof Asset, "id" | "seq" | "tag" | "createdAt" | "updatedAt">;

const COLUMNS: [ColumnKey, string][] = [
  ["tagOverride", "tag_override"],
  ["type", "type"],
  ["sn", "sn"],
  ["vendor", "vendor"],
  ["model", "model"],
  ["customerId", "customer_id"],
  ["owner", "owner"],
  ["status", "status"],
  ["location", "location"],
  ["bmcMac", "bmc_mac"],
  ["bmcIp", "bmc_ip"],
  ["bmcUser", "bmc_user"],
  ["bmcPassword", "bmc_password"],
  ["bmcFallbackUser", "bmc_fallback_user"],
  ["bmcFallbackPassword", "bmc_fallback_password"],
  ["bootMac", "boot_mac"],
  ["osAddress", "os_address"],
  ["osNetmask", "os_netmask"],
  ["hostname", "hostname"],
  ["purchaseSupplier", "purchase_supplier"],
  ["purchaseOrder", "purchase_order"],
  ["purchaseDate", "purchase_date"],
  ["purchasePrice", "purchase_price"],
  ["warrantyVendor", "warranty_vendor"],
  ["warrantyLevel", "warranty_level"],
  ["warrantyStart", "warranty_start"],
  ["warrantyEnd", "warranty_end"],
  ["note", "note"],
];

/** 资料变化记进时间线时用的名字。密码只记「改了」。 */
const FIELD_LABEL: Partial<Record<keyof Asset, string>> = {
  tagOverride: "手动编号",
  type: "类型",
  sn: "序列号",
  vendor: "厂商",
  model: "型号",
  customerId: "归属客户",
  owner: "负责人",
  location: "位置",
  bmcMac: "BMC MAC",
  bmcIp: "BMC 地址",
  bmcUser: "BMC 账号",
  bmcPassword: "BMC 密码",
  bmcFallbackUser: "BMC 备用账号",
  bmcFallbackPassword: "BMC 备用密码",
  bootMac: "装机网卡 MAC",
  osAddress: "系统地址",
  osNetmask: "系统掩码",
  hostname: "主机名",
  purchaseSupplier: "供应商",
  purchaseOrder: "采购单号",
  purchaseDate: "采购日期",
  purchasePrice: "采购价格",
  warrantyVendor: "保修方",
  warrantyLevel: "保修级别",
  warrantyStart: "保修开始",
  warrantyEnd: "保修到期",
  note: "备注",
};

const SECRET: (keyof Asset)[] = ["bmcPassword", "bmcFallbackPassword"];

type AssetRecord = Omit<Asset, "tag">;

function toAsset(row: Record<string, SqlValue>): AssetRecord {
  const asset = { id: String(row.id), seq: Number(row.seq), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } as AssetRecord;
  for (const [key, column] of COLUMNS) {
    (asset as unknown as Record<string, unknown>)[key] = key === "customerId" ? (row[column] ? String(row[column]) : null) : String(row[column] ?? "");
  }
  return asset;
}

function rawAssets(): AssetRecord[] {
  return db().prepare("SELECT * FROM assets ORDER BY seq").all().map(toAsset);
}

function withTags(records: AssetRecord[]): Asset[] {
  const settings = getTagSettings();
  const customers = new Map(listCustomers().map((item) => [item.id, item]));
  return records.map((record) => ({ ...record, tag: renderTag(record, settings, customers) }));
}

export function listAssets(): Asset[] {
  return withTags(rawAssets());
}

export function getAsset(id: string): Asset | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  const row = db().prepare("SELECT * FROM assets WHERE id = ?").get(id);
  return row ? withTags([toAsset(row)])[0] : null;
}

export function findAssetBySn(sn: string): Asset | null {
  const row = db().prepare("SELECT * FROM assets WHERE sn = ?").get(sn);
  return row ? withTags([toAsset(row)])[0] : null;
}

export function publicAsset(asset: Asset): PublicAsset {
  const { bmcPassword, bmcFallbackPassword, ...rest } = asset;
  return { ...rest, hasBmcPassword: Boolean(bmcPassword), hasBmcFallback: Boolean(bmcFallbackPassword) };
}

/** BMC 现在最可能接受的账号在前，备用账号兜底。 */
export function assetBmcAccounts(asset: Pick<Asset, "bmcUser" | "bmcPassword" | "bmcFallbackUser" | "bmcFallbackPassword">): { user: string; password: string }[] {
  const accounts = [
    { user: asset.bmcUser, password: asset.bmcPassword },
    { user: asset.bmcFallbackUser, password: asset.bmcFallbackPassword },
  ].filter((item) => item.user && item.password);
  return accounts.filter((item, index) => accounts.findIndex((other) => other.user === item.user && other.password === item.password) === index);
}

export type AssetInput = Partial<Omit<Asset, "id" | "seq" | "tag" | "createdAt" | "updatedAt">>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\r\0]/g, "").trim().slice(0, max);
}

/** 只校验给了的字段。密码给空字符串表示不改。 */
function cleanAssetInput(input: AssetInput, current: AssetRecord | null): Partial<AssetRecord> {
  const out: Partial<AssetRecord> = {};
  const has = (key: keyof AssetInput) => Object.hasOwn(input, key) && input[key] !== undefined;
  if (has("sn")) out.sn = normalizeSn(String(input.sn));
  if (has("type")) {
    if (!Object.hasOwn(ASSET_TYPES, String(input.type))) throw new Error("资产类型不对");
    out.type = input.type as AssetType;
  }
  if (has("status")) {
    if (!Object.hasOwn(ASSET_STATUS, String(input.status))) throw new Error("资产状态不对");
    out.status = input.status as AssetStatus;
  }
  if (has("customerId")) {
    const id = input.customerId ? String(input.customerId) : null;
    if (id && !getCustomer(id)) throw new Error("选的客户已经不存在，刷新页面再选");
    out.customerId = id;
  }
  if (has("tagOverride")) {
    const tag = text(input.tagOverride, 40);
    if (tag && !/^[A-Za-z0-9._-]+$/.test(tag)) throw new Error("手动编号只能用字母、数字、点、- 和 _");
    out.tagOverride = tag;
  }
  for (const key of ["bmcMac", "bootMac"] as const) {
    if (has(key)) out[key] = input[key] ? normalizeMac(String(input[key])) : "";
  }
  for (const [key, label] of [
    ["bmcIp", "BMC 地址"],
    ["osAddress", "系统地址"],
    ["osNetmask", "系统掩码"],
  ] as const) {
    if (has(key)) out[key] = input[key] ? assertIpv4(String(input[key]), label) : "";
  }
  for (const key of ["purchaseDate", "warrantyStart", "warrantyEnd"] as const) {
    if (!has(key)) continue;
    const value = text(input[key], 10);
    if (value && (!DATE.test(value) || Number.isNaN(Date.parse(value)))) throw new Error(`${FIELD_LABEL[key]}要写成 2026-10-08 这样的日期`);
    out[key] = value;
  }
  for (const key of ["bmcPassword", "bmcFallbackPassword"] as const) {
    if (has(key) && String(input[key])) out[key] = text(input[key], 64);
  }
  for (const key of ["bmcUser", "bmcFallbackUser"] as const) {
    if (has(key)) out[key] = text(input[key], 32);
  }
  for (const key of ["vendor", "model", "owner", "location", "hostname", "purchaseSupplier", "purchaseOrder", "purchasePrice", "warrantyVendor", "warrantyLevel"] as const) {
    if (has(key)) out[key] = text(input[key], 120);
  }
  if (has("note")) out.note = text(input.note, 4000);
  const warrantyStart = out.warrantyStart ?? current?.warrantyStart ?? "";
  const warrantyEnd = out.warrantyEnd ?? current?.warrantyEnd ?? "";
  if (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart) throw new Error("保修到期早于保修开始");
  return out;
}

function describeChanges(before: AssetRecord, after: AssetRecord): string[] {
  const customers = new Map(listCustomers().map((item) => [item.id, item.name]));
  const lines: string[] = [];
  for (const [key] of COLUMNS) {
    if (key === "status" || before[key] === after[key]) continue;
    const label = FIELD_LABEL[key] || key;
    if (SECRET.includes(key)) {
      lines.push(`${label}已更新`);
      continue;
    }
    const show = (value: unknown) => (key === "customerId" ? (value ? customers.get(String(value)) || "已删除的客户" : "无") : String(value || "空"));
    lines.push(`${label}：${show(before[key])} → ${show(after[key])}`);
  }
  return lines;
}

function insertAsset(record: AssetRecord): void {
  const columns = ["id", "seq", "created_at", "updated_at", ...COLUMNS.map(([, column]) => column)];
  const values: SqlValue[] = [record.id, record.seq, record.createdAt, record.updatedAt, ...COLUMNS.map(([key]) => record[key] as SqlValue)];
  db()
    .prepare(`INSERT INTO assets (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...values);
}

function writeAsset(record: AssetRecord): void {
  db()
    .prepare(`UPDATE assets SET ${COLUMNS.map(([, column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...COLUMNS.map(([key]) => record[key] as SqlValue), record.updatedAt, record.id);
}

function blankAsset(id: string, sn: string, now: string): AssetRecord {
  const seq = Number(db().prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM assets").get()?.n ?? 1);
  const record = { id, seq, createdAt: now, updatedAt: now, customerId: null, type: "server", status: "stock", sn } as AssetRecord;
  for (const [key] of COLUMNS) if ((record as unknown as Record<string, unknown>)[key] === undefined) (record as unknown as Record<string, unknown>)[key] = "";
  return record;
}

function assertTagFree(record: AssetRecord): void {
  if (!record.tagOverride) return;
  const clash = listAssets().find((item) => item.id !== record.id && item.tag === record.tagOverride);
  if (clash) throw new Error(`编号 ${record.tagOverride} 已经是 ${clash.sn} 的了`);
}

export function createAsset(input: AssetInput, actor: string): Asset {
  if (!input.sn) throw new Error("序列号必填");
  return transaction(db(), () => {
    const now = new Date().toISOString();
    const base = blankAsset(crypto.randomUUID(), "", now);
    const record = { ...base, ...cleanAssetInput(input, null) } as AssetRecord;
    if (findAssetBySn(record.sn)) throw new Error(`序列号 ${record.sn} 已经入库了`);
    assertTagFree(record);
    insertAsset(record);
    addEvent(record.id, "status", `入库，状态「${ASSET_STATUS[record.status]}」`, actor);
    return getAsset(record.id)!;
  });
}

export function updateAsset(id: string, input: AssetInput, actor: string): Asset {
  return transaction(db(), () => {
    const current = getAsset(id);
    if (!current) throw new Error("资产不存在");
    const { tag, ...before } = current;
    void tag;
    const next: AssetRecord = { ...before, ...cleanAssetInput(input, before), updatedAt: new Date().toISOString() };
    if (next.sn !== before.sn) {
      const other = findAssetBySn(next.sn);
      if (other) throw new Error(`序列号 ${next.sn} 已经是另一台资产 ${other.tag} 的了`);
    }
    assertTagFree(next);
    writeAsset(next);
    if (next.status !== before.status) addEvent(id, "status", `状态：${ASSET_STATUS[before.status]} → ${ASSET_STATUS[next.status]}`, actor);
    const changes = describeChanges(before, next);
    if (changes.length) addEvent(id, "edit", changes.join("\n"), actor);
    return getAsset(id)!;
  });
}

export function deleteAsset(id: string): Asset {
  const asset = getAsset(id);
  if (!asset) throw new Error("资产不存在");
  transaction(db(), () => {
    db().prepare("DELETE FROM asset_events WHERE asset_id = ?").run(id);
    db().prepare("DELETE FROM assets WHERE id = ?").run(id);
  });
  return asset;
}

/** 保修状态：没填到期日是 none。 */
export function warrantyState(asset: Pick<Asset, "warrantyEnd">, today = new Date().toISOString().slice(0, 10)): WarrantyState {
  if (!asset.warrantyEnd) return "none";
  if (asset.warrantyEnd < today) return "expired";
  const soon = new Date(Date.parse(today) + 90 * 86400_000).toISOString().slice(0, 10);
  return asset.warrantyEnd <= soon ? "expiring" : "valid";
}

// ---------- 装机批次同步 ----------

function rowAccount(row: ServerRow): { user: string; password: string; fallbackUser: string; fallbackPassword: string } {
  return row.passwordChanged
    ? { user: row.targetUser, password: row.targetPassword, fallbackUser: row.originalUser, fallbackPassword: row.originalPassword }
    : { user: row.originalUser, password: row.originalPassword, fallbackUser: "", fallbackPassword: "" };
}

/**
 * 装机批次里一行写盘时调用：把这一行里变了的 BMC、地址、装机进度同步到资产。没变的不碰，免得盖掉在资产页手改的值。
 * 资产不存在就按这一行建一个，id 用 row.assetId。
 */
export function syncAssetFromRow(previous: ServerRow | undefined, row: ServerRow): void {
  transaction(db(), () => {
    const now = new Date().toISOString();
    const current = getAsset(row.assetId);
    const created = !current;
    let record: AssetRecord;
    if (current) {
      const { tag, ...rest } = current;
      void tag;
      record = { ...rest };
    } else {
      if (findAssetBySn(row.sn)) return;
      record = { ...blankAsset(row.assetId, row.sn, now), status: row.installed === "yes" ? "pending" : "installing", createdAt: row.createdAt || now };
    }
    const before = { ...record };
    const changed = <K extends keyof ServerRow>(key: K) => !previous || previous[key] !== row[key];
    if (changed("ipmiMac") && row.ipmiMac) record.bmcMac = row.ipmiMac;
    if (changed("bmcIp") && row.bmcIp) record.bmcIp = row.bmcIp;
    if (changed("bootMac") && row.bootMac) record.bootMac = row.bootMac;
    if (changed("osAddress") && row.osAddress) record.osAddress = row.osAddress;
    if (changed("osNetmask") && row.osNetmask) record.osNetmask = row.osNetmask;
    const account = rowAccount(row);
    const old = previous ? rowAccount(previous) : null;
    if (account.user && account.password && (!old || JSON.stringify(old) !== JSON.stringify(account))) {
      record.bmcUser = account.user;
      record.bmcPassword = account.password;
      record.bmcFallbackUser = account.fallbackUser;
      record.bmcFallbackPassword = account.fallbackPassword;
    }
    let statusText = "";
    if (changed("installed")) {
      if (row.installed === "installing" && ["stock", "racked", "pending", "active", "offline"].includes(record.status) && previous) {
        statusText = `开始装机「${row.osName}」`;
        record.status = "installing";
      } else if (row.installed === "yes" && record.status === "installing") {
        statusText = `「${row.osName}」已装好，等待交付`;
        record.status = "pending";
      }
    }
    if (created) {
      insertAsset(record);
      addEvent(record.id, "status", `从装机批次入库，状态「${ASSET_STATUS[record.status]}」`, "装机");
      return;
    }
    if (JSON.stringify(before) === JSON.stringify(record)) return;
    record.updatedAt = now;
    writeAsset(record);
    if (statusText) addEvent(record.id, "install", `${statusText}，状态：${ASSET_STATUS[before.status]} → ${ASSET_STATUS[record.status]}`, "装机");
    const changes = describeChanges(before, record);
    if (changes.length) addEvent(record.id, "edit", changes.join("\n"), "装机");
  });
}

// ---------- 时间线和审计 ----------

export function addEvent(assetId: string, kind: string, text: string, actor = ""): void {
  db().prepare("INSERT INTO asset_events (asset_id, at, actor, kind, text) VALUES (?, ?, ?, ?, ?)").run(assetId, new Date().toISOString(), actor, kind, text.slice(0, 4000));
}

export function listEvents(assetId: string, limit = 200): AssetEvent[] {
  return db()
    .prepare("SELECT * FROM asset_events WHERE asset_id = ? ORDER BY id DESC LIMIT ?")
    .all(assetId, limit)
    .map((row) => ({ id: Number(row.id), assetId: String(row.asset_id), at: String(row.at), actor: String(row.actor), kind: String(row.kind), text: String(row.text) }));
}

export interface AuditInput {
  actor: string;
  ip?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  detail?: string;
  ok?: boolean;
}

/** 审计写失败不能让操作本身失败，只打日志。 */
export function audit(input: AuditInput): void {
  try {
    db()
      .prepare("INSERT INTO audit_log (at, actor, ip, action, target_type, target_id, target_label, detail, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        new Date().toISOString(),
        input.actor,
        input.ip || "",
        input.action,
        input.targetType || "",
        input.targetId || "",
        (input.targetLabel || "").slice(0, 200),
        (input.detail || "").slice(0, 2000),
        input.ok === false ? 0 : 1,
      );
  } catch (error) {
    console.error("[audit] 写审计失败", error);
  }
}

export interface AuditQuery {
  q?: string;
  actor?: string;
  targetId?: string;
  /** 只要 id 比它小的，翻页用。 */
  before?: number;
  limit?: number;
}

export function listAudit(query: AuditQuery = {}): AuditEntry[] {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (query.actor) {
    where.push("actor = ?");
    params.push(query.actor);
  }
  if (query.targetId) {
    where.push("target_id = ?");
    params.push(query.targetId);
  }
  if (query.before) {
    where.push("id < ?");
    params.push(query.before);
  }
  if (query.q) {
    where.push("(action LIKE ? OR target_label LIKE ? OR detail LIKE ? OR actor LIKE ? OR ip LIKE ?)");
    const like = `%${query.q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like, like, like);
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
  const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`.replace(/LIKE \?/g, "LIKE ? ESCAPE '\\'");
  return db()
    .prepare(sql)
    .all(...params, limit)
    .map((row) => ({
      id: Number(row.id),
      at: String(row.at),
      actor: String(row.actor),
      ip: String(row.ip),
      action: String(row.action),
      targetType: String(row.target_type),
      targetId: String(row.target_id),
      targetLabel: String(row.target_label),
      detail: String(row.detail),
      ok: Boolean(row.ok),
    }));
}
