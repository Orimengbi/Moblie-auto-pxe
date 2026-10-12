import { ALERT_SEVERITY } from "./asset-labels.ts";
import { addEvent, getAsset } from "./assets.ts";
import { db, transaction, type SqlValue } from "./db.ts";
import { createTicket } from "./tickets.ts";
import type { Alert, AlertSeverity, AlertSource, AlertStatus, Ticket } from "./types.ts";
import { formatTime } from "./time.ts";

/**
 * 告警。监控每查一遍得出一组「发现」，和已有的告警对：
 * 同一台同一个 key 还没恢复的只更新，不新开；状态类（传感器、BMC 连不上、掉卡、硬盘）这次没再发现就自动恢复；
 * 事件类（SEL、Xid）不会自己恢复，要人点「处理完」；SEL 里 BMC 后来写了 Deasserted 的（cleared）算自动恢复。
 * 状态类自动恢复后 30 分钟内又发现，重新打开原来那条（次数加一），不另开，免得在阈值边上跳的传感器一天开一串。
 * 内存可纠正 ECC 若干小时没再出现自动解除，见 quietMemoryEcc。
 */

export interface Finding {
  key: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  detail: string;
  sticky?: boolean;
}

function toAlert(row: Record<string, SqlValue>): Alert {
  return {
    id: Number(row.id),
    assetId: String(row.asset_id),
    key: String(row.key),
    source: row.source as AlertSource,
    severity: row.severity as AlertSeverity,
    title: String(row.title),
    detail: String(row.detail),
    status: row.status as AlertStatus,
    sticky: Boolean(row.sticky),
    count: Number(row.count),
    firstAt: String(row.first_at),
    lastAt: String(row.last_at),
    ackedBy: String(row.acked_by),
    ackedAt: String(row.acked_at),
    resolvedBy: String(row.resolved_by),
    resolvedAt: String(row.resolved_at),
    ticketId: String(row.ticket_id),
  };
}

export function getAlert(id: number): Alert | null {
  const row = db().prepare("SELECT * FROM alerts WHERE id = ?").get(id);
  return row ? toAlert(row) : null;
}

/** 没恢复的全给；已恢复的只给最近的 limit 条。 */
export function listAlerts(options: { assetId?: string; resolvedLimit?: number } = {}): Alert[] {
  const where = options.assetId ? "AND asset_id = ?" : "";
  const params: SqlValue[] = options.assetId ? [options.assetId] : [];
  const open = db().prepare(`SELECT * FROM alerts WHERE status != 'resolved' ${where} ORDER BY last_at DESC`).all(...params);
  const done = db()
    .prepare(`SELECT * FROM alerts WHERE status = 'resolved' ${where} ORDER BY resolved_at DESC LIMIT ?`)
    .all(...params, options.resolvedLimit ?? 200);
  return [...open, ...done].map(toAlert);
}

export function alertCounts(): { critical: number; warning: number } {
  const rows = db().prepare("SELECT severity, COUNT(*) AS n FROM alerts WHERE status = 'active' GROUP BY severity").all();
  const counts = { critical: 0, warning: 0 };
  for (const row of rows) counts[row.severity as AlertSeverity] = Number(row.n);
  return counts;
}

/** 状态类告警自动恢复后这么久内又出现，算同一条。 */
const REOPEN_WINDOW_MS = 30 * 60_000;

/**
 * 记下一次检查的结果。scopes 是这次实际查了的 key 前缀（例如 BMC 没连上就不该把传感器告警当成恢复）。
 * cleared 是 BMC 已经解除了的事件类 key：开着的自动恢复；这次新发现、但已经解除了的（风扇拔插这种几十秒就好的）
 * 不再开新告警，记到同 key 最近那条上，次数加一。返回新开的告警。
 */
export function applyFindings(assetId: string, findings: Finding[], scopes: string[], cleared: ReadonlySet<string> = new Set()): Alert[] {
  const asset = getAsset(assetId);
  if (!asset) return [];
  return transaction(db(), () => {
    const now = new Date().toISOString();
    const open = db()
      .prepare("SELECT * FROM alerts WHERE asset_id = ? AND status != 'resolved'")
      .all(assetId)
      .map(toAlert);
    const created: Alert[] = [];
    const seen = new Set<string>();
    for (const finding of findings) {
      if (seen.has(finding.key)) continue;
      seen.add(finding.key);
      const existing = open.find((alert) => alert.key === finding.key);
      if (existing) {
        // 状态类每次检查都会再发现一次，次数只对事件类有意义。
        const count = finding.sticky ? existing.count + 1 : existing.count;
        // 升级成严重时，已确认的重新变回告警中。
        const status = existing.status === "acked" && finding.severity === "critical" && existing.severity === "warning" ? "active" : existing.status;
        db()
          .prepare("UPDATE alerts SET severity = ?, title = ?, detail = ?, count = ?, last_at = ?, status = ? WHERE id = ?")
          .run(finding.severity, finding.title.slice(0, 200), finding.detail.slice(0, 4000), count, now, status, existing.id);
        continue;
      }
      if (finding.sticky && cleared.has(finding.key)) {
        const last = db().prepare("SELECT id FROM alerts WHERE asset_id = ? AND key = ? ORDER BY id DESC LIMIT 1").get(assetId, finding.key);
        if (last) {
          db()
            .prepare("UPDATE alerts SET severity = ?, title = ?, detail = ?, count = count + 1, last_at = ?, resolved_at = ? WHERE id = ?")
            .run(finding.severity, finding.title.slice(0, 200), finding.detail.slice(0, 4000), now, now, Number(last.id));
        } else {
          db()
            .prepare("INSERT INTO alerts (asset_id, key, source, severity, title, detail, status, sticky, count, first_at, last_at, resolved_by, resolved_at) VALUES (?, ?, ?, ?, ?, ?, 'resolved', 1, 1, ?, ?, '自动恢复', ?)")
            .run(assetId, finding.key, finding.source, finding.severity, finding.title.slice(0, 200), finding.detail.slice(0, 4000), now, now, now);
          addEvent(assetId, "alert", `${ALERT_SEVERITY[finding.severity]}告警（已自动恢复）：${finding.title}`, "监控");
        }
        continue;
      }
      if (!finding.sticky) {
        // 状态类在阈值边上来回跳的（GPU 网卡温度这种）：刚自动恢复不久又发现，重新打开原来那条，次数加一，不另开。
        const recent = db()
          .prepare("SELECT id, count FROM alerts WHERE asset_id = ? AND key = ? AND status = 'resolved' AND resolved_by = '自动恢复' AND resolved_at >= ? ORDER BY id DESC LIMIT 1")
          .get(assetId, finding.key, new Date(Date.parse(now) - REOPEN_WINDOW_MS).toISOString());
        if (recent) {
          db()
            .prepare("UPDATE alerts SET severity = ?, title = ?, detail = ?, count = count + 1, last_at = ?, status = 'active', resolved_by = '', resolved_at = '' WHERE id = ?")
            .run(finding.severity, finding.title.slice(0, 200), finding.detail.slice(0, 4000), now, Number(recent.id));
          addEvent(assetId, "alert", `${ALERT_SEVERITY[finding.severity]}告警又出现（第 ${Number(recent.count) + 1} 次）：${finding.title}`, "监控");
          continue;
        }
      }
      const result = db()
        .prepare("INSERT INTO alerts (asset_id, key, source, severity, title, detail, status, sticky, count, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?)")
        .run(assetId, finding.key, finding.source, finding.severity, finding.title.slice(0, 200), finding.detail.slice(0, 4000), finding.sticky ? 1 : 0, now, now);
      const alert = getAlert(Number(result.lastInsertRowid))!;
      created.push(alert);
      addEvent(assetId, "alert", `${ALERT_SEVERITY[alert.severity]}告警：${alert.title}`, "监控");
    }
    for (const alert of open) {
      if (alert.sticky && cleared.has(alert.key)) {
        db().prepare("UPDATE alerts SET status = 'resolved', resolved_by = '自动恢复', resolved_at = ? WHERE id = ?").run(now, alert.id);
        addEvent(assetId, "alert", `告警恢复：${alert.title}`, "监控");
        continue;
      }
      if (alert.sticky || seen.has(alert.key) || !scopes.some((scope) => alert.key.startsWith(scope))) continue;
      db().prepare("UPDATE alerts SET status = 'resolved', resolved_by = '自动恢复', resolved_at = ? WHERE id = ?").run(now, alert.id);
      addEvent(assetId, "alert", `告警恢复：${alert.title}`, "监控");
    }
    return created;
  });
}

/** 内存可纠正 ECC：SEL 里 Memory 传感器的 Correctable ECC，或 Redfish 里某根内存 Health Warning。不可纠正的（严重）不算，要人处理。 */
export function memoryEccKind(key: string, severity: AlertSeverity): "sel" | "health" | null {
  if (severity !== "warning") return null;
  if (/^sel:memory/i.test(key) && /correctable ecc/i.test(key) && !/uncorrectable/i.test(key)) return "sel";
  if (key.startsWith("health:内存 ")) return "health";
  return null;
}

/**
 * 内存可纠正 ECC 多少小时没再出现就自动解除。BMC 自己不会写 Deasserted，内存的 Health Warning 也要重启才清，不这样就永远挂着。
 * 「再出现」看 SEL 里有没有新的内存 Correctable ECC（AMI 所有内存共用 Memory #0x08 一个传感器，所以按整台算）；
 * Redfish 的 Health Warning 只要 BMC 不清会一直报，解除后在下一条 SEL ECC 出现之前不再重开。
 * 在 applyFindings 之前调，返回去掉了「安静」那些的发现。
 */
export function quietMemoryEcc(assetId: string, findings: Finding[], hours: number, nowMs = Date.now()): Finding[] {
  const since = nowMs - hours * 3_600_000;
  const now = new Date(nowMs).toISOString();
  const label = `${hours} 小时未再出现`;
  const rows = db().prepare("SELECT * FROM alerts WHERE asset_id = ? AND (key LIKE 'sel:%' OR key LIKE 'health:内存 %') ORDER BY id").all(assetId).map(toAlert);
  let lastEcc = findings.some((finding) => memoryEccKind(finding.key, finding.severity) === "sel") ? nowMs : 0;
  for (const alert of rows) if (memoryEccKind(alert.key, alert.severity) === "sel") lastEcc = Math.max(lastEcc, Date.parse(alert.lastAt));
  const resolve = (alert: Alert) => {
    db().prepare("UPDATE alerts SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE id = ?").run(label, now, alert.id);
    addEvent(assetId, "alert", `告警恢复（${label}）：${alert.title}`, "监控");
  };
  const fresh = new Set(findings.map((finding) => finding.key));
  for (const alert of rows) {
    if (alert.status !== "resolved" && memoryEccKind(alert.key, alert.severity) === "sel" && !fresh.has(alert.key) && Date.parse(alert.lastAt) < since) resolve(alert);
  }
  return findings.filter((finding) => {
    if (memoryEccKind(finding.key, finding.severity) !== "health") return true;
    const same = rows.filter((alert) => alert.key === finding.key);
    const open = same.find((alert) => alert.status !== "resolved");
    if (open) {
      if (open.severity !== "warning" || Math.max(lastEcc, Date.parse(open.firstAt)) >= since) return true;
      resolve(open);
      return false;
    }
    const last = same.at(-1);
    return !(last && last.resolvedBy.endsWith("小时未再出现") && lastEcc <= Date.parse(last.resolvedAt));
  });
}

export function ackAlert(id: number, actor: string): Alert {
  const alert = getAlert(id);
  if (!alert) throw new Error("告警不存在");
  if (alert.status !== "active") throw new Error("只有告警中的能确认");
  db().prepare("UPDATE alerts SET status = 'acked', acked_by = ?, acked_at = ? WHERE id = ?").run(actor, new Date().toISOString(), id);
  return getAlert(id)!;
}

/** 手动处理完。状态类的如果条件还在，下次检查会再开一条。 */
export function resolveAlert(id: number, actor: string): Alert {
  const alert = getAlert(id);
  if (!alert) throw new Error("告警不存在");
  if (alert.status === "resolved") return alert;
  db().prepare("UPDATE alerts SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE id = ?").run(actor, new Date().toISOString(), id);
  addEvent(alert.assetId, "alert", `告警处理完：${alert.title}`, actor);
  return getAlert(id)!;
}

/** 转工单：严重的按高优先级建故障单，告警记下工单 id。已经转过的直接给那张单。 */
export function alertToTicket(id: number, actor: string): Ticket {
  return transaction(db(), () => {
    const alert = getAlert(id);
    if (!alert) throw new Error("告警不存在");
    if (alert.ticketId) {
      const row = db().prepare("SELECT id FROM tickets WHERE id = ?").get(alert.ticketId);
      if (row) throw new Error("这条告警已经转过工单了");
    }
    const ticket = createTicket(
      {
        assetId: alert.assetId,
        title: alert.title,
        kind: "fault",
        priority: alert.severity === "critical" ? "high" : "normal",
        description: `由告警转来（${formatTime(alert.firstAt)} 起，${alert.count} 次）\n${alert.detail}`,
      },
      actor,
    );
    db().prepare("UPDATE alerts SET ticket_id = ?, status = CASE WHEN status = 'active' THEN 'acked' ELSE status END, acked_by = CASE WHEN acked_by = '' THEN ? ELSE acked_by END, acked_at = CASE WHEN acked_at = '' THEN ? ELSE acked_at END WHERE id = ?").run(ticket.id, actor, new Date().toISOString(), id);
    return ticket;
  });
}
