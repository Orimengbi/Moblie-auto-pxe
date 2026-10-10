import { assertCodeFree, countWhere, db, runOrPreview, transaction, type SqlValue } from "./db.ts";
import { cleanCode, cleanName, cleanText } from "./validate.ts";
import { FLOOR_ITEM_KINDS as FLOOR_ITEM_LABEL, RACK_FACING } from "./asset-labels.ts";
import type { Datacenter, FloorItem, FloorItemKind, FloorWall, Rack, RackFacing, Site } from "./types.ts";

/**
 * 数据中心、机房和机柜，从大到小：数据中心 → 机房 → 机柜 → 设备。
 * 资产放在哪个机柜、哪几个 U 记在资产上（rack_id、u_start、u_height），这里只管数据中心、机房和机柜本身。
 */

export const MAX_RACK_U = 60;

function toDatacenter(row: Record<string, SqlValue>): Datacenter {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    address: String(row.address),
    note: String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toSite(row: Record<string, SqlValue>): Site {
  return {
    id: String(row.id),
    datacenterId: String(row.datacenter_id ?? ""),
    code: String(row.code),
    name: String(row.name),
    address: String(row.address),
    note: String(row.note),
    floorW: Number(row.floor_w ?? 0),
    floorH: Number(row.floor_h ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toRack(row: Record<string, SqlValue>): Rack {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    name: String(row.name),
    rowLabel: String(row.row_label),
    heightU: Number(row.height_u),
    powerKw: String(row.power_kw),
    note: String(row.note),
    posX: row.pos_x === null || row.pos_x === undefined ? null : Number(row.pos_x),
    posY: row.pos_y === null || row.pos_y === undefined ? null : Number(row.pos_y),
    facing: (["up", "down", "left", "right"].includes(String(row.facing)) ? String(row.facing) : "") as RackFacing,
    disabled: Boolean(row.disabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listDatacenters(): Datacenter[] {
  return db().prepare("SELECT * FROM datacenters ORDER BY code").all().map(toDatacenter);
}

export function getDatacenter(id: string): Datacenter | null {
  const row = db().prepare("SELECT * FROM datacenters WHERE id = ?").get(id);
  return row ? toDatacenter(row) : null;
}

export interface DatacenterInput {
  code?: string;
  name?: string;
  address?: string;
  note?: string;
}

function cleanDatacenter(input: DatacenterInput, id: string | null): Pick<Datacenter, "code" | "name" | "address" | "note"> {
  const code = cleanCode(input.code, "数据中心代码");
  const name = cleanName(input.name, "数据中心名称");
  assertCodeFree("datacenters", code, id, "数据中心代码");
  return { code, name, address: cleanText(input.address, 200), note: cleanText(input.note, 1000) };
}

export function createDatacenter(input: DatacenterInput): Datacenter {
  const clean = cleanDatacenter(input, null);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db().prepare("INSERT INTO datacenters (id, code, name, address, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, clean.code, clean.name, clean.address, clean.note, now, now);
  return getDatacenter(id)!;
}

export function updateDatacenter(id: string, input: DatacenterInput): Datacenter {
  if (!getDatacenter(id)) throw new Error("数据中心不存在");
  const clean = cleanDatacenter(input, id);
  db().prepare("UPDATE datacenters SET code = ?, name = ?, address = ?, note = ?, updated_at = ? WHERE id = ?").run(clean.code, clean.name, clean.address, clean.note, new Date().toISOString(), id);
  return getDatacenter(id)!;
}

export function deleteDatacenter(id: string): Datacenter {
  const datacenter = getDatacenter(id);
  if (!datacenter) throw new Error("数据中心不存在");
  const sites = countWhere("sites", "datacenter_id", id);
  if (sites) throw new Error(`「${datacenter.name}」里还有 ${sites} 个机房，先删掉或挪走机房`);
  db().prepare("DELETE FROM datacenters WHERE id = ?").run(id);
  return datacenter;
}

export function listSites(): Site[] {
  return db().prepare("SELECT * FROM sites ORDER BY code").all().map(toSite);
}

export function getSite(id: string): Site | null {
  const row = db().prepare("SELECT * FROM sites WHERE id = ?").get(id);
  return row ? toSite(row) : null;
}

/** 机柜按机房、列、机柜号排，机柜号里的数字按大小比（A2 在 A10 前面）。 */
export function listRacks(siteId?: string): Rack[] {
  const rows = siteId ? db().prepare("SELECT * FROM racks WHERE site_id = ?").all(siteId) : db().prepare("SELECT * FROM racks").all();
  return rows
    .map(toRack)
    .sort((a, b) => a.siteId.localeCompare(b.siteId) || a.rowLabel.localeCompare(b.rowLabel, "zh-CN", { numeric: true }) || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
}

export function getRack(id: string): Rack | null {
  const row = db().prepare("SELECT * FROM racks WHERE id = ?").get(id);
  return row ? toRack(row) : null;
}

export interface SiteInput {
  datacenterId?: string;
  code?: string;
  name?: string;
  address?: string;
  note?: string;
}

/** 机房代码在所有数据中心里唯一，资产位置「机房代码 / 机柜号 / U 位」和 Excel 里只写机房代码就能认出是哪个机房。 */
function cleanSite(input: SiteInput, id: string | null): Pick<Site, "datacenterId" | "code" | "name" | "address" | "note"> {
  const datacenter = getDatacenter(String(input.datacenterId ?? ""));
  if (!datacenter) throw new Error("选的数据中心不存在");
  const code = cleanCode(input.code, "机房代码");
  const name = cleanName(input.name, "机房名称");
  assertCodeFree("sites", code, id, "机房代码");
  return { datacenterId: datacenter.id, code, name, address: cleanText(input.address, 200), note: cleanText(input.note, 1000) };
}

export function createSite(input: SiteInput): Site {
  const clean = cleanSite(input, null);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db()
    .prepare("INSERT INTO sites (id, datacenter_id, code, name, address, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, clean.datacenterId, clean.code, clean.name, clean.address, clean.note, now, now);
  return getSite(id)!;
}

/** 改 datacenterId 就是把整个机房（连同机柜和设备）挪到另一个数据中心。 */
export function updateSite(id: string, input: SiteInput): Site {
  const current = getSite(id);
  if (!current) throw new Error("机房不存在");
  const clean = cleanSite({ ...input, datacenterId: input.datacenterId ?? current.datacenterId }, id);
  db()
    .prepare("UPDATE sites SET datacenter_id = ?, code = ?, name = ?, address = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(clean.datacenterId, clean.code, clean.name, clean.address, clean.note, new Date().toISOString(), id);
  return getSite(id)!;
}

export function deleteSite(id: string): Site {
  const site = getSite(id);
  if (!site) throw new Error("机房不存在");
  const racks = countWhere("racks", "site_id", id);
  if (racks) throw new Error(`「${site.name}」里还有 ${racks} 个机柜，先删掉机柜`);
  db().prepare("DELETE FROM sites WHERE id = ?").run(id);
  return site;
}

export interface RackInput {
  siteId?: string;
  name?: string;
  rowLabel?: string;
  heightU?: number | string;
  powerKw?: string;
  note?: string;
  /** 不给就不改。 */
  disabled?: boolean;
}

function rackHeight(value: unknown): number {
  const height = Number(value ?? 42);
  if (!Number.isInteger(height) || height < 1 || height > MAX_RACK_U) throw new Error(`机柜高度需要 1 到 ${MAX_RACK_U} 的整数`);
  return height;
}

type RackFields = Omit<Rack, "id" | "createdAt" | "updatedAt" | "posX" | "posY" | "facing">;

function cleanRack(input: RackInput, id: string | null): RackFields {
  const site = getSite(String(input.siteId ?? ""));
  if (!site) throw new Error("选的机房不存在");
  const name = String(input.name ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,24}$/.test(name)) throw new Error("机柜号需要 1 到 24 位字母、数字、点、- 或 _");
  const clash = db().prepare("SELECT id FROM racks WHERE site_id = ? AND name = ? AND id != ?").get(site.id, name, id || "");
  if (clash) throw new Error(`「${site.name}」里已经有机柜 ${name}`);
  const heightU = rackHeight(input.heightU);
  const current = id ? getRack(id) : null;
  const disabled = input.disabled === undefined ? Boolean(current?.disabled) : Boolean(input.disabled);
  if (id && disabled && !current?.disabled && countWhere("assets", "rack_id", id)) throw new Error("机柜里还有设备，先挪走再设成不可用");
  if (id) {
    // 改矮了不能把已经放着的设备挤出去。
    const top = Number(db().prepare("SELECT MAX(u_start + u_height - 1) AS top FROM assets WHERE rack_id = ? AND u_start IS NOT NULL AND u_height > 0").get(id)?.top ?? 0);
    if (top > heightU) throw new Error(`机柜里有设备放到了 U${top}，不能改成 ${heightU}U`);
  }
  return {
    siteId: site.id,
    name,
    rowLabel: String(input.rowLabel ?? "").trim().slice(0, 24),
    heightU,
    powerKw: String(input.powerKw ?? "").trim().slice(0, 24),
    note: String(input.note ?? "").trim().slice(0, 1000),
    disabled,
  };
}

function insertRack(clean: RackFields): Rack {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db()
    .prepare("INSERT INTO racks (id, site_id, name, row_label, height_u, power_kw, note, disabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, clean.siteId, clean.name, clean.rowLabel, clean.heightU, clean.powerKw, clean.note, clean.disabled ? 1 : 0, now, now);
  return getRack(id)!;
}

export function createRack(input: RackInput): Rack {
  return insertRack(cleanRack(input, null));
}

/**
 * 把前缀写法展开成一组前缀：「A」「A,B,C」「A-H」「A1-A3」都行。字母范围按字母表，带数字的范围按数字。
 */
export function expandPrefixes(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean)) {
    const letters = /^([A-Za-z])-([A-Za-z])$/.exec(part);
    const numbered = /^([A-Za-z_-]*?)(\d+)-\1?(\d+)$/.exec(part);
    if (letters) {
      const [a, b] = [letters[1].charCodeAt(0), letters[2].charCodeAt(0)];
      if (b < a) throw new Error(`前缀范围 ${part} 反了`);
      for (let code = a; code <= b; code++) out.push(String.fromCharCode(code));
    } else if (numbered) {
      const [from, to] = [Number(numbered[2]), Number(numbered[3])];
      if (to < from || to - from > 100) throw new Error(`前缀范围 ${part} 不对`);
      for (let n = from; n <= to; n++) out.push(`${numbered[1]}${String(n).padStart(numbered[2].length, "0")}`);
    } else {
      if (!/^[A-Za-z0-9._-]{0,16}$/.test(part)) throw new Error(`前缀「${part}」只能用字母、数字、点、- 和 _`);
      out.push(part);
    }
  }
  return out.length ? [...new Set(out)] : [""];
}

/**
 * 批量建机柜：每个前缀（每一排）加一段编号，例如 A-C + 1..20、补零 2 位 → A01…A20、B01…B20、C01…C20。
 * 「列 / 排」没填时用前缀。已经有的跳过。
 */
export function createRacks(input: RackInput & { prefix?: string; from?: number | string; to?: number | string; pad?: number | string }): { created: Rack[]; skipped: string[] } {
  const from = Number(input.from);
  const to = Number(input.to);
  const pad = Number(input.pad ?? 2);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) throw new Error("编号范围不对");
  if (!Number.isInteger(pad) || pad < 0 || pad > 4) throw new Error("补零位数需要 0 到 4");
  const prefixes = expandPrefixes(String(input.prefix ?? ""));
  if (prefixes.length * (to - from + 1) > 1000) throw new Error(`一次最多建 1000 个机柜，这次是 ${prefixes.length} 排 × ${to - from + 1} 个`);
  return transaction(db(), () => {
    const created: Rack[] = [];
    const skipped: string[] = [];
    for (const prefix of prefixes) {
      for (let n = from; n <= to; n++) {
        const name = `${prefix}${String(n).padStart(pad, "0")}`;
        if (db().prepare("SELECT id FROM racks WHERE site_id = ? AND name = ?").get(String(input.siteId ?? ""), name)) {
          skipped.push(name);
          continue;
        }
        created.push(insertRack(cleanRack({ ...input, name, rowLabel: String(input.rowLabel ?? "").trim() || prefix }, null)));
      }
    }
    return { created, skipped };
  });
}

export const RACK_SHEET_HEADERS = ["机房", "机柜号", "列/排", "高度U", "额定功率", "朝向", "不可用", "备注"];

type RackSheetField = "site" | "name" | "rowLabel" | "heightU" | "powerKw" | "facing" | "disabled" | "note";

const RACK_HEADER: Record<string, RackSheetField> = {
  朝向: "facing",
  正面朝向: "facing",
  不可用: "disabled",
  是否不可用: "disabled",
  状态: "disabled",
  机房: "site",
  机房代码: "site",
  机柜: "name",
  机柜号: "name",
  机柜名: "name",
  "列/排": "rowLabel",
  列: "rowLabel",
  排: "rowLabel",
  高度u: "heightU",
  高度: "heightU",
  u数: "heightU",
  额定功率: "powerKw",
  功率: "powerKw",
  备注: "note",
};

/** Excel 里的朝向：上、朝上、up、北 → up；下、朝下、down、南 → down；不设、无、- → 空。 */
function parseFacing(value: string): RackFacing {
  const key = value.trim().toLowerCase();
  if (["上", "朝上", "up", "u", "北", "前"].includes(key)) return "up";
  if (["下", "朝下", "down", "d", "南", "后"].includes(key)) return "down";
  if (["左", "朝左", "left", "l", "西"].includes(key)) return "left";
  if (["右", "朝右", "right", "r", "东"].includes(key)) return "right";
  if (["", "不设", "无", "-", "none"].includes(key)) return "";
  throw new Error(`朝向「${value}」认不出，写「上」「下」「左」或「右」`);
}

/** 是、不可用、y、1、true → true；否、可用、n、0、false → false。 */
function parseYes(value: string): boolean {
  const key = value.trim().toLowerCase();
  if (["是", "不可用", "y", "yes", "1", "true", "√"].includes(key)) return true;
  if (["否", "可用", "n", "no", "0", "false", ""].includes(key)) return false;
  throw new Error(`「不可用」列写「是」或「否」，不认「${value}」`);
}

export interface RackImportRow {
  row: number;
  site: string;
  name: string;
  action: "create" | "update" | "same" | "error";
  message: string;
}

/**
 * Excel 导入机柜：一行一个。机房写代码或名称，没有机房列时用 defaultSiteId。同一机房里已经有这个机柜号的只改填了的格子。
 * dryRun 只预览。一行出错只跳过这一行。
 */
export function importRacks(rows: unknown[][], defaultSiteId: string | null, options: { dryRun?: boolean } = {}): { rows: RackImportRow[]; created: number; updated: number; errors: number } {
  const key = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\s*＊]+/g, "").replace("／", "/");
  const headerAt = rows.slice(0, 8).findIndex((row) => (row || []).some((cell) => RACK_HEADER[key(cell)] === "name"));
  if (headerAt < 0) throw new Error("没有找到表头。表头那一行要有「机柜号」，可以先下载模板对照");
  const fields = (rows[headerAt] || []).map((cell) => RACK_HEADER[key(cell)]);
  const result = { rows: [] as RackImportRow[], created: 0, updated: 0, errors: 0 };
  const sites = listSites();
  return runOrPreview(options.dryRun, () => {
    for (let i = headerAt + 1; i < rows.length; i++) {
      const raw = rows[i] || [];
      if (!raw.some((cell) => String(cell ?? "").trim())) continue;
      const cells: Partial<Record<RackSheetField, string>> = {};
      fields.forEach((field, column) => {
        const value = String(raw[column] ?? "").trim();
        if (field && value) cells[field] = value;
      });
      const entry: RackImportRow = { row: i + 1, site: cells.site || "", name: cells.name || "", action: "error", message: "" };
      try {
        const site = cells.site ? sites.find((item) => item.code.toLowerCase() === cells.site!.toLowerCase() || item.name.toLowerCase() === cells.site!.toLowerCase()) : defaultSiteId ? getSite(defaultSiteId) : null;
        if (!site) throw new Error(cells.site ? `没有机房「${cells.site}」，先建好` : "没写机房");
        entry.site = site.code;
        if (!cells.name) throw new Error("没写机柜号");
        const facing = cells.facing !== undefined ? parseFacing(cells.facing) : undefined;
        const disabled = cells.disabled !== undefined ? parseYes(cells.disabled) : undefined;
        transaction(db(), () => {
          const existing = listRacks(site.id).find((rack) => rack.name === cells.name);
          if (!existing) {
            const made = createRack({ siteId: site.id, name: cells.name, rowLabel: cells.rowLabel, heightU: cells.heightU ?? 42, powerKw: cells.powerKw, note: cells.note, disabled });
            if (facing) db().prepare("UPDATE racks SET facing = ? WHERE id = ?").run(facing, made.id);
            entry.action = "create";
            result.created++;
            return;
          }
          const wanted = {
            rowLabel: cells.rowLabel ?? existing.rowLabel,
            heightU: cells.heightU !== undefined ? Number(cells.heightU) : existing.heightU,
            powerKw: cells.powerKw ?? existing.powerKw,
            note: cells.note ?? existing.note,
            disabled: disabled ?? existing.disabled,
            facing: facing ?? existing.facing,
          };
          const changed = (["rowLabel", "heightU", "powerKw", "note", "disabled", "facing"] as const).filter((field) => wanted[field] !== existing[field]);
          // 没变的不写，免得白白改更新时间。
          let next = existing;
          if (changed.length) {
            next = updateRack(existing.id, { siteId: site.id, name: existing.name, ...wanted, heightU: cells.heightU ?? existing.heightU });
            if (wanted.facing !== existing.facing) db().prepare("UPDATE racks SET facing = ? WHERE id = ?").run(wanted.facing, existing.id);
            next = { ...next, facing: wanted.facing };
          }
          const show = (field: (typeof changed)[number], value: unknown) =>
            field === "disabled" ? (value ? "不可用" : "可用") : field === "facing" ? RACK_FACING[value as RackFacing] : String(value || "空");
          entry.action = changed.length ? "update" : "same";
          entry.message = changed.map((field) => `${{ rowLabel: "列/排", heightU: "高度", powerKw: "功率", note: "备注", disabled: "状态", facing: "朝向" }[field]}：${show(field, existing[field])} → ${show(field, next[field])}`).join("，");
          if (changed.length) result.updated++;
        });
      } catch (error) {
        entry.action = "error";
        entry.message = error instanceof Error ? error.message : "这一行不对";
        result.errors++;
      }
      result.rows.push(entry);
    }
    return result;
  });
}

export function updateRack(id: string, input: RackInput): Rack {
  if (!getRack(id)) throw new Error("机柜不存在");
  const clean = cleanRack(input, id);
  db()
    .prepare("UPDATE racks SET site_id = ?, name = ?, row_label = ?, height_u = ?, power_kw = ?, note = ?, disabled = ?, updated_at = ? WHERE id = ?")
    .run(clean.siteId, clean.name, clean.rowLabel, clean.heightU, clean.powerKw, clean.note, clean.disabled ? 1 : 0, new Date().toISOString(), id);
  return getRack(id)!;
}

export function deleteRack(id: string): Rack {
  const rack = getRack(id);
  if (!rack) throw new Error("机柜不存在");
  const used = countWhere("assets", "rack_id", id);
  if (used) throw new Error(`机柜 ${rack.name} 里还有 ${used} 台设备，先把它们挪走`);
  db().prepare("DELETE FROM racks WHERE id = ?").run(id);
  return rack;
}

/** 「机房代码 / 机柜号 / U10-U17」，侧挂写「侧挂」，没定 U 位只写到机柜。 */
export function placeLabel(asset: { rackId: string | null; uStart: number | null; uHeight: number }, racks: Map<string, Rack>, sites: Map<string, Site>): string {
  if (!asset.rackId) return "";
  const rack = racks.get(asset.rackId);
  if (!rack) return "";
  const site = sites.get(rack.siteId);
  const u = asset.uHeight === 0 ? "侧挂" : asset.uStart ? (asset.uHeight > 1 ? `U${asset.uStart}-U${asset.uStart + asset.uHeight - 1}` : `U${asset.uStart}`) : "";
  return [site?.code, rack.name, u].filter(Boolean).join(" / ");
}

/**
 * 按数据中心、机房（代码或名称）和机柜号找机柜（Excel 导入用）。数据中心和机房都可以不写，但找到的机柜要唯一。
 * 返回的函数里这几张表只读一次，整个导入复用。代码和名称不分大小写。
 */
export function cachedRackFinder(): (siteText: string, rackName: string, datacenterText?: string) => Rack | null | "ambiguous" {
  const datacenters = listDatacenters();
  const sites = listSites();
  const racks = listRacks();
  const same = (item: { code: string; name: string }, key: string) => item.code.toLowerCase() === key || item.name.toLowerCase() === key;
  return (siteText, rackName, datacenterText = "") => {
    const dcKey = datacenterText.trim().toLowerCase();
    const datacenter = dcKey ? datacenters.find((item) => same(item, dcKey)) : null;
    if (dcKey && !datacenter) return null;
    const key = siteText.trim().toLowerCase();
    const site = key ? sites.find((item) => (!datacenter || item.datacenterId === datacenter.id) && same(item, key)) : null;
    if (key && !site) return null;
    const inDatacenter = new Set(sites.filter((item) => !datacenter || item.datacenterId === datacenter.id).map((item) => item.id));
    const name = rackName.trim().toLowerCase();
    const matches = racks.filter((rack) => (site ? rack.siteId === site.id : inDatacenter.has(rack.siteId)) && rack.name.toLowerCase() === name);
    if (matches.length > 1) return "ambiguous";
    return matches[0] || null;
  };
}

export const MAX_FLOOR = 200;

export interface LayoutItem {
  id: string;
  /** 都给 null 表示回到自动排布。 */
  x: number | null;
  y: number | null;
  facing?: RackFacing;
  /** 不给就不改。 */
  disabled?: boolean;
}

const FLOOR_KINDS: FloorItemKind[] = ["door", "pillar", "ac", "power", "switch", "ups", "fire", "blocked", "other"];
const WALLS: FloorWall[] = ["top", "bottom", "left", "right"];
const FACINGS: RackFacing[] = ["", "up", "down", "left", "right"];

export function listFloorItems(siteId?: string): FloorItem[] {
  const rows = siteId ? db().prepare("SELECT * FROM floor_items WHERE site_id = ? ORDER BY y, x").all(siteId) : db().prepare("SELECT * FROM floor_items ORDER BY y, x").all();
  return rows.map((row) => ({
    id: String(row.id),
    siteId: String(row.site_id),
    kind: row.kind as FloorItemKind,
    label: String(row.label),
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    side: String(row.side ?? "") as FloorWall,
  }));
}

/** 障碍物占的格子。开在墙上的（门）不占机房里的格子。 */
export function floorItemCells(item: Pick<FloorItem, "x" | "y" | "w" | "h"> & { side?: FloorWall }): string[] {
  const cells: string[] = [];
  if (item.side) return cells;
  for (let dx = 0; dx < item.w; dx++) for (let dy = 0; dy < item.h; dy++) cells.push(`${item.x + dx},${item.y + dy}`);
  return cells;
}

/**
 * 保存一个机房的俯视图布局。racks 只改给了的机柜；obstacles 给了就整体替换这个机房的障碍物（柱子等）。
 * 机柜和机柜、机柜和障碍物、障碍物和障碍物都不能占同一格。没摆过位置（自动排布）的机柜在页面上已经避开障碍物，这里不查。
 */
export function saveLayout(
  siteId: string,
  items: LayoutItem[],
  obstacles?: (Omit<FloorItem, "id" | "siteId" | "side"> & { side?: FloorWall })[],
  /** 要删掉的机柜（批量改成柱子等障碍物时用，障碍物本身在 obstacles 里）。必须是空柜。 */
  remove: string[] = [],
  /** 机房的宽、深（格子数），给了就改；0 表示不设外墙。 */
  room?: { w: number; h: number },
): { racks: Rack[]; obstacles: FloorItem[]; site: Site } {
  const site = getSite(siteId);
  if (!site) throw new Error("机房不存在");
  return transaction(db(), () => {
    let roomW = site.floorW;
    let roomH = site.floorH;
    if (room) {
      [roomW, roomH] = [room.w, room.h].map(Number);
      if (![roomW, roomH].every((value) => Number.isInteger(value) && value >= 0 && value <= MAX_FLOOR)) throw new Error(`机房的宽和深要是 0 到 ${MAX_FLOOR} 的整数`);
      if (!roomW !== !roomH) throw new Error("机房的宽和深要一起填，或者都填 0 不画外墙");
      db().prepare("UPDATE sites SET floor_w = ?, floor_h = ?, updated_at = ? WHERE id = ?").run(roomW, roomH, new Date().toISOString(), siteId);
    }
    /** 设了机房大小时，东西都要在墙里面。 */
    const inside = (x: number, y: number, w: number, h: number) => !roomW || (x + w <= roomW && y + h <= roomH);
    const racks = new Map(listRacks(siteId).map((rack) => [rack.id, rack]));
    const now = new Date().toISOString();
    for (const id of remove) {
      const rack = racks.get(id);
      if (!rack) throw new Error("要删的机柜不在这个机房里，刷新页面再改");
      const used = countWhere("assets", "rack_id", id);
      if (used) throw new Error(`机柜 ${rack.name} 里还有 ${used} 台设备，不能改成障碍物`);
      db().prepare("DELETE FROM racks WHERE id = ?").run(id);
      racks.delete(id);
    }
    items = items.filter((item) => !remove.includes(item.id));
    for (const item of items) {
      const rack = racks.get(item.id);
      if (!rack) throw new Error("布局里有不属于这个机房的机柜，刷新页面再改");
      const placed = item.x !== null && item.y !== null;
      if (placed && (![item.x, item.y].every((value) => Number.isInteger(value) && value! >= 0 && value! < MAX_FLOOR))) throw new Error(`机柜 ${rack.name} 的位置不对`);
      if (placed && !inside(item.x!, item.y!, 1, 1)) throw new Error(`机柜 ${rack.name} 在机房外墙外面，把机房改大或者挪进来`);
      const facing = item.facing ?? rack.facing;
      if (!FACINGS.includes(facing)) throw new Error("朝向只能是上、下、左、右或不设");
      const disabled = item.disabled ?? rack.disabled;
      if (disabled && !rack.disabled) {
        const used = countWhere("assets", "rack_id", rack.id);
        if (used) throw new Error(`机柜 ${rack.name} 里还有 ${used} 台设备，先挪走再设成不可用`);
      }
      racks.set(rack.id, { ...rack, posX: placed ? item.x : null, posY: placed ? item.y : null, facing, disabled });
      db()
        .prepare("UPDATE racks SET pos_x = ?, pos_y = ?, facing = ?, disabled = ?, updated_at = ? WHERE id = ?")
        .run(placed ? item.x : null, placed ? item.y : null, facing, disabled ? 1 : 0, now, rack.id);
    }
    if (obstacles) {
      if (obstacles.length > 1000) throw new Error("障碍物太多了");
      db().prepare("DELETE FROM floor_items WHERE site_id = ?").run(siteId);
      for (const raw of obstacles) {
        const kind = FLOOR_KINDS.includes(raw.kind) ? raw.kind : "other";
        const side: FloorWall = WALLS.includes(raw.side as FloorWall) ? (raw.side as FloorWall) : "";
        const [x, y, w, h] = [side === "left" || side === "right" ? 0 : raw.x, side === "top" || side === "bottom" ? 0 : raw.y, raw.w ?? 1, side ? 1 : (raw.h ?? 1)].map(Number);
        if (![x, y].every((value) => Number.isInteger(value) && value >= 0 && value < MAX_FLOOR) || ![w, h].every((value) => Number.isInteger(value) && value >= 1 && value <= 20)) {
          throw new Error("障碍物的位置或大小不对");
        }
        const name = raw.label || FLOOR_ITEM_LABEL[kind];
        if (side) {
          if (!roomW) throw new Error(`「${name}」开在墙上，要先设机房的宽和深`);
          const along = side === "top" || side === "bottom" ? roomW : roomH;
          const offset = side === "top" || side === "bottom" ? x : y;
          if (offset + w > along) throw new Error(`「${name}」超出了那面墙`);
        } else if (!inside(x, y, w, h)) {
          throw new Error(`「${name}」在机房外墙外面，把机房改大或者挪进来`);
        }
        db()
          .prepare("INSERT INTO floor_items (id, site_id, kind, label, x, y, w, h, side, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), siteId, kind, cleanText(raw.label, 20), x, y, w, h, side, now);
      }
    }
    const taken = new Map<string, string>();
    const occupy = (key: string, label: string) => {
      if (taken.has(key)) throw new Error(`${taken.get(key)} 和 ${label} 放在了同一格`);
      taken.set(key, label);
    };
    for (const item of listFloorItems(siteId)) for (const key of floorItemCells(item)) occupy(key, item.label || "障碍物");
    for (const rack of racks.values()) if (rack.posX !== null && rack.posY !== null) occupy(`${rack.posX},${rack.posY}`, `机柜 ${rack.name}`);
    // 只改机房大小、没重新给东西时，已经存着的也要在墙里面。
    for (const item of listFloorItems(siteId)) {
      const name = item.label || FLOOR_ITEM_LABEL[item.kind];
      if (item.side && !roomW) throw new Error(`「${name}」开在墙上，机房要设宽和深`);
      if (item.side && (item.side === "top" || item.side === "bottom" ? item.x : item.y) + item.w > (item.side === "top" || item.side === "bottom" ? roomW : roomH)) throw new Error(`「${name}」超出了那面墙，机房不能改这么小`);
      if (!item.side && !inside(item.x, item.y, item.w, item.h)) throw new Error(`「${name}」在机房外墙外面，机房不能改这么小`);
    }
    for (const rack of racks.values()) {
      if (rack.posX !== null && rack.posY !== null && !inside(rack.posX, rack.posY, 1, 1)) throw new Error(`机柜 ${rack.name} 在机房外墙外面，机房不能改这么小`);
    }
    // 门之间不能重叠（同一面墙上）。
    const walls = new Map<string, string>();
    for (const item of listFloorItems(siteId).filter((entry) => entry.side)) {
      for (let d = 0; d < item.w; d++) {
        const key = `${item.side}:${(item.side === "top" || item.side === "bottom" ? item.x : item.y) + d}`;
        if (walls.has(key)) throw new Error(`${walls.get(key)} 和 ${item.label || FLOOR_ITEM_LABEL[item.kind]} 在墙上重叠了`);
        walls.set(key, item.label || FLOOR_ITEM_LABEL[item.kind]);
      }
    }
    return { racks: listRacks(siteId), obstacles: listFloorItems(siteId), site: getSite(siteId)! };
  });
}
