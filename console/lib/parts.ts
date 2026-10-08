import { PART_KINDS, PART_STATUS } from "./asset-labels.ts";
import { addEvent, getAsset } from "./assets.ts";
import { db, transaction, type SqlValue } from "./db.ts";
import { getSite } from "./racks.ts";
import type { HwChange, HwComponent, HwKind, Part, PartEvent, PartKind, PartStatus } from "./types.ts";

/**
 * 备件：每件一条。在库的放在某个机房的库位里，装上机器的记着装在哪台资产、哪个槽位。
 * 每次入库、装机、拆下、返修、报废都记一条 part_events，换件时带上工单 id。
 */

const COLUMNS: [keyof Part, string][] = [
  ["kind", "kind"],
  ["model", "model"],
  ["vendor", "vendor"],
  ["sn", "sn"],
  ["status", "status"],
  ["siteId", "site_id"],
  ["bin", "bin"],
  ["assetId", "asset_id"],
  ["slot", "slot"],
  ["supplier", "supplier"],
  ["purchaseOrder", "purchase_order"],
  ["warrantyEnd", "warranty_end"],
  ["note", "note"],
];

function toPart(row: Record<string, SqlValue>): Part {
  const part = { id: String(row.id), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } as Part;
  for (const [key, column] of COLUMNS) {
    const value = row[column];
    (part as unknown as Record<string, unknown>)[key] = key === "siteId" || key === "assetId" ? (value ? String(value) : null) : String(value ?? "");
  }
  return part;
}

function writePart(part: Part): void {
  db()
    .prepare(`UPDATE parts SET ${COLUMNS.map(([, column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...COLUMNS.map(([key]) => part[key] as SqlValue), part.updatedAt, part.id);
}

function insertPart(part: Part): void {
  const columns = ["id", "created_at", "updated_at", ...COLUMNS.map(([, column]) => column)];
  db()
    .prepare(`INSERT INTO parts (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(part.id, part.createdAt, part.updatedAt, ...COLUMNS.map(([key]) => part[key] as SqlValue));
}

export function listParts(): Part[] {
  return db().prepare("SELECT * FROM parts ORDER BY kind, model, sn").all().map(toPart);
}

export function getPart(id: string): Part | null {
  const row = db().prepare("SELECT * FROM parts WHERE id = ?").get(id);
  return row ? toPart(row) : null;
}

/** 序列号不分大小写对（采集到的和手填的大小写常常不一样）。 */
export function findPartBySn(sn: string): Part | null {
  if (!sn.trim()) return null;
  const row = db().prepare("SELECT * FROM parts WHERE sn != '' AND UPPER(sn) = UPPER(?)").get(sn.trim());
  return row ? toPart(row) : null;
}

export function partsOfAsset(assetId: string): Part[] {
  return db().prepare("SELECT * FROM parts WHERE asset_id = ? ORDER BY kind, slot").all(assetId).map(toPart);
}

export function addPartEvent(partId: string, kind: string, text: string, actor: string, ticketId = ""): void {
  db().prepare("INSERT INTO part_events (part_id, at, actor, kind, text, ticket_id) VALUES (?, ?, ?, ?, ?, ?)").run(partId, new Date().toISOString(), actor, kind, text.slice(0, 2000), ticketId);
}

export function listPartEvents(partId: string): PartEvent[] {
  return db()
    .prepare("SELECT * FROM part_events WHERE part_id = ? ORDER BY id DESC")
    .all(partId)
    .map((row) => ({ id: Number(row.id), partId: String(row.part_id), at: String(row.at), actor: String(row.actor), kind: String(row.kind), text: String(row.text), ticketId: String(row.ticket_id) }));
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\r\0]/g, "").trim().slice(0, max);
}

function assertKind(kind: unknown): PartKind {
  if (!Object.hasOwn(PART_KINDS, String(kind))) throw new Error("备件类型不对");
  return kind as PartKind;
}

function assertSn(sn: string, selfId = ""): string {
  if (sn.length > 80 || /[\s,;]/.test(sn)) throw new Error(`序列号「${sn}」不能有空格、逗号，最多 80 位`);
  const other = findPartBySn(sn);
  if (other && other.id !== selfId) throw new Error(`序列号 ${sn} 已经在备件库里了（${PART_STATUS[other.status]}）`);
  return sn;
}

function siteOrNull(id: unknown): string | null {
  if (!id) return null;
  if (!getSite(String(id))) throw new Error("选的机房不存在");
  return String(id);
}

/** 「GPU NVIDIA B300 SN XXX」，记录里用。 */
export function partLabel(part: Pick<Part, "kind" | "model" | "sn">): string {
  return [PART_KINDS[part.kind], part.model, part.sn ? `SN ${part.sn}` : "无序列号"].filter(Boolean).join(" ");
}

export interface ReceiveInput {
  kind?: string;
  model?: string;
  vendor?: string;
  siteId?: string | null;
  bin?: string;
  supplier?: string;
  purchaseOrder?: string;
  warrantyEnd?: string;
  note?: string;
  /** 一行一个序列号，也可以用逗号、空格隔开。 */
  sns?: string[] | string;
  /** 没有序列号时入库几件。 */
  quantity?: number | string;
}

/** 入库：给了序列号就一个号一件，没给就按数量建没有序列号的。有一个号重复就整批不入。 */
export function receiveParts(input: ReceiveInput, actor: string): Part[] {
  const kind = assertKind(input.kind);
  const model = cleanText(input.model, 120);
  if (!model) throw new Error("型号必填");
  const sns = (Array.isArray(input.sns) ? input.sns : String(input.sns ?? "").split(/[\s,;，；]+/)).map((sn) => sn.trim()).filter(Boolean);
  const quantity = sns.length ? sns.length : Number(input.quantity || 0);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("填序列号，或者填 1 到 1000 的数量");
  const repeated = sns.find((sn, index) => sns.findIndex((other) => other.toUpperCase() === sn.toUpperCase()) !== index);
  if (repeated) throw new Error(`序列号 ${repeated} 写了两遍`);
  const warrantyEnd = cleanText(input.warrantyEnd, 10);
  if (warrantyEnd && !/^\d{4}-\d{2}-\d{2}$/.test(warrantyEnd)) throw new Error("保修到期要写成 2026-10-08 这样的日期");
  return transaction(db(), () => {
    const now = new Date().toISOString();
    const siteId = siteOrNull(input.siteId);
    const made: Part[] = [];
    for (let i = 0; i < quantity; i++) {
      const part: Part = {
        id: crypto.randomUUID(),
        kind,
        model,
        vendor: cleanText(input.vendor, 80),
        sn: sns[i] ? assertSn(sns[i]) : "",
        status: "stock",
        siteId,
        bin: cleanText(input.bin, 40),
        assetId: null,
        slot: "",
        supplier: cleanText(input.supplier, 120),
        purchaseOrder: cleanText(input.purchaseOrder, 120),
        warrantyEnd,
        note: cleanText(input.note, 1000),
        createdAt: now,
        updatedAt: now,
      };
      insertPart(part);
      addPartEvent(part.id, "in", `入库${siteId ? `到 ${getSite(siteId)?.code}${part.bin ? ` ${part.bin}` : ""}` : ""}`, actor);
      made.push(part);
    }
    return made;
  });
}

export interface PartEdit {
  kind?: string;
  model?: string;
  vendor?: string;
  sn?: string;
  siteId?: string | null;
  bin?: string;
  supplier?: string;
  purchaseOrder?: string;
  warrantyEnd?: string;
  note?: string;
}

/** 改备件的资料（不改状态和装在哪）。 */
export function updatePart(id: string, input: PartEdit, actor: string): Part {
  return transaction(db(), () => {
    const part = getPart(id);
    if (!part) throw new Error("备件不存在");
    const next: Part = { ...part };
    if (input.kind !== undefined) next.kind = assertKind(input.kind);
    if (input.model !== undefined) next.model = cleanText(input.model, 120);
    if (input.vendor !== undefined) next.vendor = cleanText(input.vendor, 80);
    if (input.sn !== undefined) next.sn = cleanText(input.sn, 80) ? assertSn(cleanText(input.sn, 80), id) : "";
    if (input.siteId !== undefined) next.siteId = siteOrNull(input.siteId);
    if (input.bin !== undefined) next.bin = cleanText(input.bin, 40);
    if (input.supplier !== undefined) next.supplier = cleanText(input.supplier, 120);
    if (input.purchaseOrder !== undefined) next.purchaseOrder = cleanText(input.purchaseOrder, 120);
    if (input.warrantyEnd !== undefined) {
      next.warrantyEnd = cleanText(input.warrantyEnd, 10);
      if (next.warrantyEnd && !/^\d{4}-\d{2}-\d{2}$/.test(next.warrantyEnd)) throw new Error("保修到期要写成 2026-10-08 这样的日期");
    }
    if (input.note !== undefined) next.note = cleanText(input.note, 1000);
    if (!next.model) throw new Error("型号必填");
    const changed = COLUMNS.filter(([key]) => part[key] !== next[key]).map(([key]) => key);
    if (!changed.length) return part;
    next.updatedAt = new Date().toISOString();
    writePart(next);
    addPartEvent(id, "edit", `改了 ${changed.join("、")}`, actor);
    return next;
  });
}

/**
 * 改状态。装机用 installPart；这里管在库、已拆下、待返修、返修中、报废。从机器上改成别的状态等于拆下来。
 */
export function setPartStatus(id: string, status: PartStatus, actor: string, options: { siteId?: string | null; bin?: string; note?: string; ticketId?: string } = {}): Part {
  if (!Object.hasOwn(PART_STATUS, status) || status === "installed") throw new Error("装机要从工单换件或在资产上装");
  return transaction(db(), () => {
    const part = getPart(id);
    if (!part) throw new Error("备件不存在");
    if (part.status === status && options.siteId === undefined && options.bin === undefined) return part;
    const next: Part = { ...part, status, updatedAt: new Date().toISOString() };
    const from = part.assetId ? getAsset(part.assetId) : null;
    if (part.assetId) {
      next.assetId = null;
      next.slot = "";
      addEvent(part.assetId, "hardware", `拆下 ${partLabel(part)}${part.slot ? `（${part.slot}）` : ""}，${PART_STATUS[status]}`, actor);
    }
    if (options.siteId !== undefined) next.siteId = siteOrNull(options.siteId);
    if (options.bin !== undefined) next.bin = cleanText(options.bin, 40);
    writePart(next);
    const where = status === "stock" && next.siteId ? `，放到 ${getSite(next.siteId)?.code}${next.bin ? ` ${next.bin}` : ""}` : "";
    addPartEvent(id, status, `${PART_STATUS[part.status]} → ${PART_STATUS[status]}${from ? `，从 ${from.tag} 拆下` : ""}${where}${options.note ? `：${options.note}` : ""}`, actor, options.ticketId);
    return next;
  });
}

/** 把一件备件装到资产上。只有在库、已拆下的能装。 */
export function installPart(id: string, assetId: string, slot: string, actor: string, ticketId = ""): Part {
  return transaction(db(), () => {
    const part = getPart(id);
    if (!part) throw new Error("备件不存在");
    const asset = getAsset(assetId);
    if (!asset) throw new Error("资产不存在");
    if (part.status !== "stock" && part.status !== "removed") throw new Error(`${partLabel(part)} 现在是「${PART_STATUS[part.status]}」，不能装`);
    const next: Part = { ...part, status: "installed", assetId, slot: cleanText(slot, 80), updatedAt: new Date().toISOString() };
    writePart(next);
    addPartEvent(id, "install", `装到 ${asset.tag}${next.slot ? `（${next.slot}）` : ""}`, actor, ticketId);
    return next;
  });
}

export function deletePart(id: string): Part {
  const part = getPart(id);
  if (!part) throw new Error("备件不存在");
  transaction(db(), () => {
    db().prepare("DELETE FROM part_events WHERE part_id = ?").run(id);
    db().prepare("DELETE FROM parts WHERE id = ?").run(id);
  });
  return part;
}

/** 在库数量按类型和型号汇总。 */
export function stockSummary(): { kind: PartKind; model: string; count: number }[] {
  return db()
    .prepare("SELECT kind, model, COUNT(*) AS n FROM parts WHERE status = 'stock' GROUP BY kind, model ORDER BY kind, model")
    .all()
    .map((row) => ({ kind: row.kind as PartKind, model: String(row.model), count: Number(row.n) }));
}

const KIND_FROM_HW: Partial<Record<HwKind, PartKind>> = {
  cpu: "cpu",
  memory: "memory",
  disk: "disk",
  gpu: "gpu",
  nic: "nic",
  transceiver: "transceiver",
  psu: "psu",
  board: "board",
};

export function partKindOf(kind: HwKind): PartKind | null {
  return KIND_FROM_HW[kind] || null;
}

function componentText(item: HwComponent | undefined): string {
  if (!item) return "";
  return [item.model, item.sn ? `SN ${item.sn}` : ""].filter(Boolean).join(" ");
}

/**
 * 硬件采集比出了部件变化：记进资产时间线；新出现的序列号正好是库里的备件就标成装在这台上，
 * 原来记着装在这台上、这次不见了的标成「已拆下」。系统内和 BMC 两边各调一次，备件状态第二次已经对了就不再改。
 */
export function recordHardwareChanges(assetId: string, changes: HwChange[], source: string): void {
  const asset = getAsset(assetId);
  if (!asset) return;
  const relevant = changes.filter((change) => change.type !== "changed" && partKindOf(change.kind) && (change.before?.sn || change.after?.sn));
  if (!relevant.length) return;
  const actor = `硬件采集（${source === "os" ? "系统内" : "BMC"}）`;
  transaction(db(), () => {
    const lines: string[] = [];
    for (const change of relevant) {
      const label = PART_KINDS[partKindOf(change.kind)!];
      if (change.type === "replaced") lines.push(`${label} ${change.slot}：${componentText(change.before)} → ${componentText(change.after)}`);
      else if (change.type === "added") lines.push(`${label} ${change.slot} 新增：${componentText(change.after)}`);
      else lines.push(`${label} ${change.slot} 不见了：${componentText(change.before)}`);
      const gone = change.before?.sn ? findPartBySn(change.before.sn) : null;
      if (gone && gone.assetId === assetId && change.type !== "added") {
        writePart({ ...gone, status: "removed", assetId: null, slot: "", updatedAt: new Date().toISOString() });
        addPartEvent(gone.id, "removed", `采集发现已不在 ${asset.tag} 上`, actor);
      }
      const arrived = change.after?.sn ? findPartBySn(change.after.sn) : null;
      if (arrived && arrived.assetId !== assetId && (arrived.status === "stock" || arrived.status === "removed")) {
        writePart({ ...arrived, status: "installed", assetId, slot: change.slot, updatedAt: new Date().toISOString() });
        addPartEvent(arrived.id, "install", `采集发现装在 ${asset.tag}（${change.slot}）`, actor);
      }
    }
    addEvent(assetId, "hardware", `采集发现部件变化：\n${lines.join("\n")}`, actor);
  });
}

/** 换件时登记一件库里原来没有的：换下来的旧件，或者直接装上去的新件。 */
export function registerPart(
  input: { kind: PartKind; model: string; sn: string; vendor?: string },
  status: PartStatus,
  where: { assetId?: string | null; slot?: string; siteId?: string | null },
  actor: string,
  text: string,
  ticketId = "",
): Part {
  return transaction(db(), () => {
    const now = new Date().toISOString();
    const part: Part = {
      id: crypto.randomUUID(),
      kind: assertKind(input.kind),
      model: cleanText(input.model, 120) || "未知型号",
      vendor: cleanText(input.vendor, 80),
      sn: input.sn.trim() ? assertSn(input.sn.trim()) : "",
      status,
      siteId: siteOrNull(where.siteId),
      bin: "",
      assetId: where.assetId || null,
      slot: cleanText(where.slot, 80),
      supplier: "",
      purchaseOrder: "",
      warrantyEnd: "",
      note: "",
      createdAt: now,
      updatedAt: now,
    };
    insertPart(part);
    addPartEvent(part.id, status, text, actor, ticketId);
    return part;
  });
}
