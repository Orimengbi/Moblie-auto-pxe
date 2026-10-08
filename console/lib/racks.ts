import { assertCodeFree, countWhere, db, runOrPreview, transaction, type SqlValue } from "./db.ts";
import { cleanCode, cleanName, cleanText } from "./validate.ts";
import type { Rack, Site } from "./types.ts";

/** 机房和机柜。资产放在哪个机柜、哪几个 U 记在资产上（rack_id、u_start、u_height），这里只管机房和机柜本身。 */

export const MAX_RACK_U = 60;

function toSite(row: Record<string, SqlValue>): Site {
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

function toRack(row: Record<string, SqlValue>): Rack {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    name: String(row.name),
    rowLabel: String(row.row_label),
    heightU: Number(row.height_u),
    powerKw: String(row.power_kw),
    note: String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
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
  code?: string;
  name?: string;
  address?: string;
  note?: string;
}

function cleanSite(input: SiteInput, id: string | null): Pick<Site, "code" | "name" | "address" | "note"> {
  const code = cleanCode(input.code, "机房代码");
  const name = cleanName(input.name, "机房名称");
  assertCodeFree("sites", code, id, "机房代码");
  return { code, name, address: cleanText(input.address, 200), note: cleanText(input.note, 1000) };
}

export function createSite(input: SiteInput): Site {
  const clean = cleanSite(input, null);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db().prepare("INSERT INTO sites (id, code, name, address, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, clean.code, clean.name, clean.address, clean.note, now, now);
  return getSite(id)!;
}

export function updateSite(id: string, input: SiteInput): Site {
  if (!getSite(id)) throw new Error("机房不存在");
  const clean = cleanSite(input, id);
  db().prepare("UPDATE sites SET code = ?, name = ?, address = ?, note = ?, updated_at = ? WHERE id = ?").run(clean.code, clean.name, clean.address, clean.note, new Date().toISOString(), id);
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
}

function rackHeight(value: unknown): number {
  const height = Number(value ?? 42);
  if (!Number.isInteger(height) || height < 1 || height > MAX_RACK_U) throw new Error(`机柜高度需要 1 到 ${MAX_RACK_U} 的整数`);
  return height;
}

function cleanRack(input: RackInput, id: string | null): Omit<Rack, "id" | "createdAt" | "updatedAt"> {
  const site = getSite(String(input.siteId ?? ""));
  if (!site) throw new Error("选的机房不存在");
  const name = String(input.name ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,24}$/.test(name)) throw new Error("机柜号需要 1 到 24 位字母、数字、点、- 或 _");
  const clash = db().prepare("SELECT id FROM racks WHERE site_id = ? AND name = ? AND id != ?").get(site.id, name, id || "");
  if (clash) throw new Error(`「${site.name}」里已经有机柜 ${name}`);
  const heightU = rackHeight(input.heightU);
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
  };
}

function insertRack(clean: Omit<Rack, "id" | "createdAt" | "updatedAt">): Rack {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db()
    .prepare("INSERT INTO racks (id, site_id, name, row_label, height_u, power_kw, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, clean.siteId, clean.name, clean.rowLabel, clean.heightU, clean.powerKw, clean.note, now, now);
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

export const RACK_SHEET_HEADERS = ["机房", "机柜号", "列/排", "高度U", "额定功率", "备注"];

const RACK_HEADER: Record<string, "site" | "name" | "rowLabel" | "heightU" | "powerKw" | "note"> = {
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
      const cells: Partial<Record<"site" | "name" | "rowLabel" | "heightU" | "powerKw" | "note", string>> = {};
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
        transaction(db(), () => {
          const existing = listRacks(site.id).find((rack) => rack.name === cells.name);
          if (!existing) {
            createRack({ siteId: site.id, name: cells.name, rowLabel: cells.rowLabel, heightU: cells.heightU ?? 42, powerKw: cells.powerKw, note: cells.note });
            entry.action = "create";
            result.created++;
            return;
          }
          const wanted = {
            rowLabel: cells.rowLabel ?? existing.rowLabel,
            heightU: cells.heightU !== undefined ? Number(cells.heightU) : existing.heightU,
            powerKw: cells.powerKw ?? existing.powerKw,
            note: cells.note ?? existing.note,
          };
          const changed = (["rowLabel", "heightU", "powerKw", "note"] as const).filter((field) => wanted[field] !== existing[field]);
          // 没变的不写，免得白白改更新时间。
          const next = changed.length ? updateRack(existing.id, { siteId: site.id, name: existing.name, ...wanted, heightU: cells.heightU ?? existing.heightU }) : existing;
          entry.action = changed.length ? "update" : "same";
          entry.message = changed.map((field) => `${{ rowLabel: "列/排", heightU: "高度", powerKw: "功率", note: "备注" }[field]}：${existing[field] || "空"} → ${next[field] || "空"}`).join("，");
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
    .prepare("UPDATE racks SET site_id = ?, name = ?, row_label = ?, height_u = ?, power_kw = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(clean.siteId, clean.name, clean.rowLabel, clean.heightU, clean.powerKw, clean.note, new Date().toISOString(), id);
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
 * 按机房代码或名称、机柜号找机柜（Excel 导入用）。只给机柜号时要在所有机房里唯一。
 * 返回的函数里机房和机柜表只读一次，整个导入复用。机房名不分大小写。
 */
export function cachedRackFinder(): (siteText: string, rackName: string) => Rack | null | "ambiguous" {
  const sites = listSites();
  const racks = listRacks();
  return (siteText, rackName) => {
    const key = siteText.trim().toLowerCase();
    const site = key ? sites.find((item) => item.code.toLowerCase() === key || item.name.toLowerCase() === key) : null;
    if (key && !site) return null;
    const name = rackName.trim().toLowerCase();
    const matches = racks.filter((rack) => (!site || rack.siteId === site.id) && rack.name.toLowerCase() === name);
    if (matches.length > 1) return "ambiguous";
    return matches[0] || null;
  };
}
