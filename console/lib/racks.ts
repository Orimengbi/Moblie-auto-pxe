import { db, transaction, type SqlValue } from "./db.ts";
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
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,16}$/.test(code)) throw new Error("机房代码需要 1 到 16 位字母、数字、- 或 _");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 80) throw new Error("机房名称需要 1 到 80 个字符");
  const clash = db().prepare("SELECT name FROM sites WHERE code = ? AND id != ?").get(code, id || "");
  if (clash) throw new Error(`机房代码 ${code} 已经给了「${clash.name}」`);
  return { code, name, address: String(input.address ?? "").trim().slice(0, 200), note: String(input.note ?? "").trim().slice(0, 1000) };
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
  const racks = Number(db().prepare("SELECT COUNT(*) AS n FROM racks WHERE site_id = ?").get(id)?.n ?? 0);
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
 * 批量建机柜：前缀加一段编号，例如 A + 1..20、补零 2 位 → A01…A20。已经有的跳过。
 */
export function createRacks(input: RackInput & { prefix?: string; from?: number | string; to?: number | string; pad?: number | string }): { created: Rack[]; skipped: string[] } {
  const from = Number(input.from);
  const to = Number(input.to);
  const pad = Number(input.pad ?? 2);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) throw new Error("编号范围不对");
  if (to - from >= 200) throw new Error("一次最多建 200 个机柜");
  if (!Number.isInteger(pad) || pad < 0 || pad > 4) throw new Error("补零位数需要 0 到 4");
  const prefix = String(input.prefix ?? "").trim();
  return transaction(db(), () => {
    const created: Rack[] = [];
    const skipped: string[] = [];
    for (let n = from; n <= to; n++) {
      const name = `${prefix}${String(n).padStart(pad, "0")}`;
      if (db().prepare("SELECT id FROM racks WHERE site_id = ? AND name = ?").get(String(input.siteId ?? ""), name)) {
        skipped.push(name);
        continue;
      }
      created.push(insertRack(cleanRack({ ...input, name }, null)));
    }
    return { created, skipped };
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
  const used = Number(db().prepare("SELECT COUNT(*) AS n FROM assets WHERE rack_id = ?").get(id)?.n ?? 0);
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

/** 按机房代码或名称、机柜号找机柜。只给机柜号时要在所有机房里唯一。Excel 导入用。 */
export function findRack(siteText: string, rackName: string): Rack | null | "ambiguous" {
  const key = siteText.trim().toLowerCase();
  const site = key ? listSites().find((item) => item.code.toLowerCase() === key || item.name.toLowerCase() === key) : null;
  if (key && !site) return null;
  const matches = listRacks(site?.id).filter((rack) => rack.name.toLowerCase() === rackName.trim().toLowerCase());
  if (matches.length > 1) return "ambiguous";
  return matches[0] || null;
}
