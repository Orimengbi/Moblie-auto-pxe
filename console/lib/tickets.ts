import { ASSET_STATUS, OPEN_TICKET_STATUS, PART_KINDS, PART_STATUS, TICKET_KINDS, TICKET_PRIORITY, TICKET_STATUS } from "./asset-labels.ts";
import { addEvent, getAsset, updateAsset } from "./assets.ts";
import { db, transaction, type SqlValue } from "./db.ts";
import { cleanText, pickEnum } from "./validate.ts";
import { findPartBySn, getPart, installPart, partLabel, registerPart, setPartStatus } from "./parts.ts";
import type { AssetStatus, Part, PartKind, PartStatus, Ticket, TicketKind, TicketLog, TicketPriority, TicketStatus } from "./types.ts";

/**
 * 维修工单。开故障、维修单时可以把资产转成「维修中」，记下原来的状态，这台的单子都解决后改回去。
 * 换件在工单里做：旧件拆下（库里没有就登记一件），新件装上（库里挑或直接填序列号）。
 */

/** 「还没解决」的状态条件，和参数一起给。 */
const OPEN_CLAUSE = `status IN (${OPEN_TICKET_STATUS.map(() => "?").join(", ")})`;

function ticketNo(seq: number, createdAt: string): string {
  return `WO-${createdAt.slice(0, 4)}-${String(seq).padStart(4, "0")}`;
}

function toTicket(row: Record<string, SqlValue>): Ticket {
  const createdAt = String(row.created_at);
  const seq = Number(row.seq);
  return {
    id: String(row.id),
    seq,
    no: ticketNo(seq, createdAt),
    assetId: row.asset_id ? String(row.asset_id) : null,
    title: String(row.title),
    kind: row.kind as TicketKind,
    priority: row.priority as TicketPriority,
    status: row.status as TicketStatus,
    assignee: String(row.assignee),
    reporter: String(row.reporter),
    description: String(row.description),
    vendorCase: String(row.vendor_case),
    prevAssetStatus: String(row.prev_asset_status) as AssetStatus | "",
    createdAt,
    updatedAt: String(row.updated_at),
    resolvedAt: String(row.resolved_at),
    closedAt: String(row.closed_at),
  };
}

export function listTickets(): Ticket[] {
  return db().prepare("SELECT * FROM tickets ORDER BY seq DESC").all().map(toTicket);
}

export function ticketsOfAsset(assetId: string): Ticket[] {
  return db().prepare("SELECT * FROM tickets WHERE asset_id = ? ORDER BY seq DESC").all(assetId).map(toTicket);
}

export function getTicket(id: string): Ticket | null {
  const row = db().prepare("SELECT * FROM tickets WHERE id = ?").get(id);
  return row ? toTicket(row) : null;
}

export function listTicketLogs(ticketId: string): TicketLog[] {
  return db()
    .prepare("SELECT * FROM ticket_logs WHERE ticket_id = ? ORDER BY id")
    .all(ticketId)
    .map((row) => ({ id: Number(row.id), ticketId: String(row.ticket_id), at: String(row.at), actor: String(row.actor), kind: String(row.kind), text: String(row.text) }));
}

function log(ticketId: string, kind: string, text: string, actor: string): void {
  db().prepare("INSERT INTO ticket_logs (ticket_id, at, actor, kind, text) VALUES (?, ?, ?, ?, ?)").run(ticketId, new Date().toISOString(), actor, kind, text.slice(0, 8000));
}

const text = cleanText;

export interface TicketInput {
  assetId?: string | null;
  title?: string;
  kind?: string;
  priority?: string;
  assignee?: string;
  description?: string;
  vendorCase?: string;
  /** 把资产转成「维修中」。不给时故障、维修单默认转。 */
  setRepair?: boolean;
}

export function createTicket(input: TicketInput, actor: string): Ticket {
  const title = text(input.title, 200);
  if (!title) throw new Error("标题必填");
  const kind = pickEnum(TICKET_KINDS, input.kind || "fault", "工单类型");
  const priority = pickEnum(TICKET_PRIORITY, input.priority || "normal", "优先级");
  const asset = input.assetId ? getAsset(String(input.assetId)) : null;
  if (input.assetId && !asset) throw new Error("选的资产不存在");
  return transaction(db(), () => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const seq = Number(db().prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM tickets").get()?.n ?? 1);
    const setRepair = input.setRepair ?? (kind === "fault" || kind === "repair");
    let prev: AssetStatus | "" = "";
    if (asset && setRepair && asset.status !== "repair" && asset.status !== "scrapped") {
      prev = asset.status;
      updateAsset(asset.id, { status: "repair" }, actor);
    } else if (asset && setRepair && asset.status === "repair") {
      // 已经被别的单转成维修中：跟着记同一个原状态，所有这样的单都解决了才改回去。
      const holder = db()
        .prepare(`SELECT prev_asset_status FROM tickets WHERE asset_id = ? AND prev_asset_status != '' AND ${OPEN_CLAUSE} LIMIT 1`)
        .get(asset.id, ...OPEN_TICKET_STATUS);
      prev = (holder ? String(holder.prev_asset_status) : "") as AssetStatus | "";
    }
    db()
      .prepare(
        "INSERT INTO tickets (id, seq, asset_id, title, kind, priority, status, assignee, reporter, description, vendor_case, prev_asset_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, seq, asset?.id || null, title, kind, priority, text(input.assignee, 40), actor, text(input.description, 8000), text(input.vendorCase, 80), prev, now, now);
    const ticket = getTicket(id)!;
    log(id, "create", `建单：${TICKET_KINDS[kind]}，优先级${TICKET_PRIORITY[priority]}${prev && asset ? `，资产维修中（原来是「${ASSET_STATUS[prev]}」）` : ""}`, actor);
    if (asset) addEvent(asset.id, "ticket", `${ticket.no} 建单：${title}`, actor);
    return ticket;
  });
}

const FIELD_LABEL: Record<string, string> = { title: "标题", kind: "类型", priority: "优先级", assignee: "负责人", description: "描述", vendorCase: "厂商工单号" };

export function updateTicket(id: string, input: TicketInput, actor: string): Ticket {
  return transaction(db(), () => {
    const ticket = getTicket(id);
    if (!ticket) throw new Error("工单不存在");
    const next = { ...ticket };
    if (input.title !== undefined) next.title = text(input.title, 200) || ticket.title;
    if (input.kind !== undefined) next.kind = pickEnum(TICKET_KINDS, input.kind, "工单类型");
    if (input.priority !== undefined) next.priority = pickEnum(TICKET_PRIORITY, input.priority, "优先级");
    if (input.assignee !== undefined) next.assignee = text(input.assignee, 40);
    if (input.description !== undefined) next.description = text(input.description, 8000);
    if (input.vendorCase !== undefined) next.vendorCase = text(input.vendorCase, 80);
    const lines: string[] = [];
    for (const key of Object.keys(FIELD_LABEL) as (keyof Ticket)[]) {
      if (next[key] === ticket[key]) continue;
      if (key === "description") lines.push("改了描述");
      else {
        const show = (value: unknown) => (key === "kind" ? TICKET_KINDS[value as TicketKind] : key === "priority" ? TICKET_PRIORITY[value as TicketPriority] : String(value || "空"));
        lines.push(`${FIELD_LABEL[key]}：${show(ticket[key])} → ${show(next[key])}`);
      }
    }
    if (!lines.length) return ticket;
    next.updatedAt = new Date().toISOString();
    db()
      .prepare("UPDATE tickets SET title = ?, kind = ?, priority = ?, assignee = ?, description = ?, vendor_case = ?, updated_at = ? WHERE id = ?")
      .run(next.title, next.kind, next.priority, next.assignee, next.description, next.vendorCase, next.updatedAt, id);
    log(id, "edit", lines.join("\n"), actor);
    return getTicket(id)!;
  });
}

/**
 * 改状态。解决或关闭时，资产如果是这张单转成「维修中」的、而且没有别的没解决的单让它维修中，就改回原来的状态。
 * 重新打开时再转回「维修中」。
 */
export function setTicketStatus(id: string, status: TicketStatus, actor: string, note = ""): Ticket {
  pickEnum(TICKET_STATUS, status, "工单状态");
  return transaction(db(), () => {
    const ticket = getTicket(id);
    if (!ticket) throw new Error("工单不存在");
    if (ticket.status === status) return ticket;
    const now = new Date().toISOString();
    const done = status === "resolved" || status === "closed";
    const wasDone = ticket.status === "resolved" || ticket.status === "closed";
    const resolvedAt = status === "resolved" ? now : status === "closed" ? ticket.resolvedAt || now : "";
    const closedAt = status === "closed" ? now : "";
    let prev = ticket.prevAssetStatus;
    const asset = ticket.assetId ? getAsset(ticket.assetId) : null;
    const extra: string[] = [];
    if (asset && prev && done && !wasDone && asset.status === "repair") {
      const others = db()
        .prepare(`SELECT COUNT(*) AS n FROM tickets WHERE asset_id = ? AND id != ? AND prev_asset_status != '' AND ${OPEN_CLAUSE}`)
        .get(asset.id, id, ...OPEN_TICKET_STATUS);
      if (!Number(others?.n)) {
        updateAsset(asset.id, { status: prev }, actor);
        extra.push(`资产改回「${ASSET_STATUS[prev]}」`);
      }
    }
    if (asset && prev && !done && wasDone && asset.status !== "repair" && asset.status !== "scrapped") {
      prev = asset.status;
      updateAsset(asset.id, { status: "repair" }, actor);
      extra.push("资产转为「维修中」");
    }
    db().prepare("UPDATE tickets SET status = ?, prev_asset_status = ?, resolved_at = ?, closed_at = ?, updated_at = ? WHERE id = ?").run(status, prev, resolvedAt, closedAt, now, id);
    log(id, "status", `${TICKET_STATUS[ticket.status]} → ${TICKET_STATUS[status]}${extra.length ? `，${extra.join("，")}` : ""}${note ? `\n${note}` : ""}`, actor);
    if (asset && done !== wasDone) addEvent(asset.id, "ticket", `${ticket.no} ${TICKET_STATUS[status]}：${ticket.title}`, actor);
    return getTicket(id)!;
  });
}

export function commentTicket(id: string, body: string, actor: string): void {
  if (!getTicket(id)) throw new Error("工单不存在");
  const comment = text(body, 8000);
  if (!comment) throw new Error("评论是空的");
  transaction(db(), () => {
    log(id, "comment", comment, actor);
    db().prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  });
}

export interface ReplaceInput {
  kind?: string;
  slot?: string;
  /** 换下来的旧件。 */
  oldSn?: string;
  oldModel?: string;
  /** 旧件拆下后的状态：待返修（默认）、已拆下、报废。 */
  oldStatus?: PartStatus;
  /** 新件：库里挑一件，或者直接填序列号和型号。 */
  newPartId?: string;
  newSn?: string;
  newModel?: string;
}

/** 在工单里换一件。旧件、新件至少给一个（只拆不装或只装不拆也行）。 */
export function replacePart(ticketId: string, input: ReplaceInput, actor: string): { removed: Part | null; installed: Part | null } {
  const ticket = getTicket(ticketId);
  if (!ticket) throw new Error("工单不存在");
  if (!ticket.assetId) throw new Error("这张工单没有关联资产，不能换件");
  const asset = getAsset(ticket.assetId);
  if (!asset) throw new Error("资产已经不存在");
  if (!Object.hasOwn(PART_KINDS, String(input.kind))) throw new Error("选一下部件类型");
  const kind = input.kind as PartKind;
  const slot = text(input.slot, 80);
  const oldSn = text(input.oldSn, 80);
  const oldModel = text(input.oldModel, 120);
  const oldStatus = input.oldStatus || "faulty";
  if (!["faulty", "removed", "scrapped"].includes(oldStatus)) throw new Error("旧件只能标成待返修、已拆下或报废");
  const newSn = text(input.newSn, 80);
  if (!oldSn && !oldModel && !input.newPartId && !newSn) throw new Error("旧件和新件至少填一个");
  return transaction(db(), () => {
    let removed: Part | null = null;
    if (oldSn || oldModel) {
      const known = oldSn ? findPartBySn(oldSn) : null;
      if (known) {
        if (known.assetId && known.assetId !== asset.id) throw new Error(`${oldSn} 记着装在别的机器上`);
        removed = setPartStatus(known.id, oldStatus, actor, { ticketId, note: `${ticket.no} 换下` });
      } else {
        removed = registerPart({ kind, model: oldModel, sn: oldSn }, oldStatus, {}, actor, `${ticket.no} 从 ${asset.tag}${slot ? `（${slot}）` : ""} 换下，${PART_STATUS[oldStatus]}`, ticketId);
      }
    }
    let installed: Part | null = null;
    if (input.newPartId) {
      const part = getPart(input.newPartId);
      if (!part) throw new Error("选的备件已经不存在");
      installed = installPart(part.id, asset.id, slot, actor, ticketId);
    } else if (newSn) {
      const known = findPartBySn(newSn);
      installed = known
        ? installPart(known.id, asset.id, slot, actor, ticketId)
        : registerPart({ kind, model: text(input.newModel, 120) || oldModel, sn: newSn }, "installed", { assetId: asset.id, slot }, actor, `${ticket.no} 装到 ${asset.tag}${slot ? `（${slot}）` : ""}`, ticketId);
    }
    const line = `换件 ${PART_KINDS[kind]}${slot ? ` ${slot}` : ""}：${removed ? partLabel(removed) : "（没有旧件）"} → ${installed ? partLabel(installed) : "（没装新件）"}${removed ? `；旧件${PART_STATUS[removed.status]}` : ""}`;
    log(ticketId, "replace", line, actor);
    addEvent(asset.id, "hardware", `${ticket.no} ${line}`, actor);
    db().prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), ticketId);
    return { removed, installed };
  });
}

/** 和这张工单有关的备件（换下来的、装上去的）。 */
export function partsOfTicket(ticketId: string): Part[] {
  return db()
    .prepare("SELECT DISTINCT part_id FROM part_events WHERE ticket_id = ?")
    .all(ticketId)
    .map((row) => getPart(String(row.part_id)))
    .filter((part): part is Part => part !== null);
}

export function openTicketCount(): number {
  return Number(db().prepare(`SELECT COUNT(*) AS n FROM tickets WHERE ${OPEN_CLAUSE}`).get(...OPEN_TICKET_STATUS)?.n ?? 0);
}
