import https from "node:https";
import { applyFindings } from "./alerts.ts";
import { assetBmcAccounts, getAsset, listAssets } from "./assets.ts";
import { openSession, rfGet } from "./bmc-redfish.ts";
import { db, type SqlValue } from "./db.ts";
import { getMonitorSettings, monitored } from "./monitor.ts";
import type { Asset } from "./types.ts";

/**
 * BMC 事件的实时推送。不用 Redfish 的推送订阅（要 BMC 能连回控制台，控制台不在 BMC 网段上），
 * 而是由控制台连到每台 BMC 的 /redfish/v1/EventService/SSE，长连着收事件。
 * 只连监控范围内、有 BMC 地址的服务器；断了按 10 秒、30 秒……最长 5 分钟重连。
 * 事件都记进 bmc_events；严重和警告的开告警（sticky，要人处理）。
 */

export interface BmcEvent {
  id: number;
  assetId: string;
  at: string;
  receivedAt: string;
  severity: string;
  messageId: string;
  message: string;
  origin: string;
}

export interface StreamStatus {
  state: "connecting" | "connected" | "waiting" | "off";
  since: string;
  error: string;
  events: number;
}

const KEEP_PER_ASSET = 500;

function toEvent(row: Record<string, SqlValue>): BmcEvent {
  return {
    id: Number(row.id),
    assetId: String(row.asset_id),
    at: String(row.at),
    receivedAt: String(row.received_at),
    severity: String(row.severity),
    messageId: String(row.message_id),
    message: String(row.message),
    origin: String(row.origin),
  };
}

export function listBmcEvents(assetId: string, limit = 100): BmcEvent[] {
  return db().prepare("SELECT * FROM bmc_events WHERE asset_id = ? ORDER BY id DESC LIMIT ?").all(assetId, limit).map(toEvent);
}

/** AMI 有时把 EventTimestamp 给成 Unix 秒数的字符串。 */
export function eventTime(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (/^\d{9,11}$/.test(text)) return new Date(Number(text) * 1000).toISOString();
  const parsed = Date.parse(text.replace(/-00:00$/, "Z"));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

interface RawEvent {
  EventTimestamp?: unknown;
  Severity?: string;
  MessageSeverity?: string;
  MessageId?: string;
  Message?: string;
  OriginOfCondition?: { "@odata.id"?: string } | string;
}

/** 一条 SSE 的 data 里是一个 Event 文档，Events 里可能有几条。 */
export function parseEventPayload(data: string, now = new Date().toISOString()): Omit<BmcEvent, "id" | "assetId">[] {
  let doc: { Events?: RawEvent[] } & RawEvent;
  try {
    doc = JSON.parse(data);
  } catch {
    return [];
  }
  const list = Array.isArray(doc.Events) ? doc.Events : doc.MessageId ? [doc] : [];
  return list.map((event) => ({
    at: eventTime(event.EventTimestamp, now),
    receivedAt: now,
    severity: String(event.MessageSeverity || event.Severity || ""),
    messageId: String(event.MessageId || ""),
    message: String(event.Message || "").slice(0, 2000),
    origin: typeof event.OriginOfCondition === "string" ? event.OriginOfCondition : String(event.OriginOfCondition?.["@odata.id"] || ""),
  }));
}

/** 按 SSE 的格式切：空行分隔一条，data: 开头的行拼起来。返回切出来的 data 和没切完的剩余。 */
export function splitSse(buffer: string): { messages: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const messages = blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n"),
    )
    .filter(Boolean);
  return { messages, rest };
}

/** 任务进度这类事件只记不报。 */
function alertable(event: Omit<BmcEvent, "id" | "assetId">): "critical" | "warning" | null {
  if (/^Task\./.test(event.messageId)) return null;
  const severity = event.severity.toLowerCase();
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return null;
}

export function recordEvents(assetId: string, events: Omit<BmcEvent, "id" | "assetId">[]): void {
  if (!events.length) return;
  const insert = db().prepare("INSERT INTO bmc_events (asset_id, at, received_at, severity, message_id, message, origin) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const event of events) insert.run(assetId, event.at, event.receivedAt, event.severity, event.messageId, event.message, event.origin);
  db()
    .prepare("DELETE FROM bmc_events WHERE asset_id = ? AND id <= (SELECT id FROM bmc_events WHERE asset_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)")
    .run(assetId, assetId, KEEP_PER_ASSET);
  const findings = events.flatMap((event) => {
    const severity = alertable(event);
    if (!severity) return [];
    return [
      {
        key: `redfish:${event.messageId}:${event.origin}`.slice(0, 200),
        source: "sel" as const,
        severity,
        title: event.message.slice(0, 120) || event.messageId,
        detail: `${event.at} ${event.messageId}${event.origin ? ` ${event.origin}` : ""}\n${event.message}`,
        sticky: true,
      },
    ];
  });
  if (findings.length) applyFindings(assetId, findings, []);
}

// ---------- 连接管理 ----------

interface Stream {
  key: string;
  status: StreamStatus;
  request: ReturnType<typeof https.request> | null;
  timer: ReturnType<typeof setTimeout> | null;
  failures: number;
  stopped: boolean;
}

declare global {
  var pxeEventStreams: Map<string, Stream> | undefined;
}

function streams(): Map<string, Stream> {
  globalThis.pxeEventStreams ||= new Map();
  return globalThis.pxeEventStreams;
}

export function streamStatus(assetId: string): StreamStatus {
  return streams().get(assetId)?.status || { state: "off", since: "", error: "", events: 0 };
}

/** 资产的地址或账号变了要重连。 */
function streamKey(asset: Asset): string {
  return JSON.stringify([asset.bmcIp, assetBmcAccounts(asset)]);
}

function setStatus(stream: Stream, state: StreamStatus["state"], error = ""): void {
  stream.status = { ...stream.status, state, error, since: new Date().toISOString() };
}

function schedule(assetId: string, stream: Stream): void {
  if (stream.stopped) return;
  const delays = [10, 30, 60, 120, 300];
  const delay = delays[Math.min(stream.failures, delays.length - 1)] * 1000;
  stream.failures++;
  setStatus(stream, "waiting", stream.status.error);
  stream.timer = setTimeout(() => void connect(assetId, stream), delay);
}

async function connect(assetId: string, stream: Stream): Promise<void> {
  if (stream.stopped) return;
  const asset = getAsset(assetId);
  if (!asset?.bmcIp) return;
  setStatus(stream, "connecting");
  let ssePath = "";
  let account: { user: string; password: string } | undefined;
  try {
    const session = await openSession(asset);
    account = assetBmcAccounts(asset).find((item) => item.user === session.user);
    const service = await rfGet(session, "/redfish/v1/EventService");
    if (service.ServiceEnabled === false) throw new Error("BMC 的事件服务没开");
    ssePath = typeof service.ServerSentEventUri === "string" ? service.ServerSentEventUri : "";
    if (!ssePath) throw new Error("BMC 不支持 SSE 事件流");
  } catch (error) {
    stream.status.error = error instanceof Error ? error.message : "连不上";
    return schedule(assetId, stream);
  }
  if (stream.stopped || !account) return;
  const auth = `Basic ${Buffer.from(`${account.user}:${account.password}`).toString("base64")}`;
  const request = https.request(
    { host: asset.bmcIp, port: Number(process.env.PXE_KVM_BMC_PORT || 443), path: ssePath, method: "GET", rejectUnauthorized: false, headers: { Authorization: auth, Accept: "text/event-stream" } },
    (response) => {
      if (response.statusCode !== 200) {
        stream.status.error = `事件流 HTTP ${response.statusCode}`;
        response.resume();
        return;
      }
      stream.failures = 0;
      setStatus(stream, "connected");
      response.setEncoding("utf8");
      let buffer = "";
      response.on("data", (chunk: string) => {
        const { messages, rest } = splitSse(buffer + chunk);
        buffer = rest.slice(-200_000);
        for (const message of messages) {
          const events = parseEventPayload(message);
          stream.status.events += events.length;
          try {
            recordEvents(assetId, events);
          } catch (error) {
            console.error("[events] 记录 BMC 事件失败", error);
          }
        }
      });
    },
  );
  stream.request = request;
  // BMC 没事时不发东西；10 分钟一点数据都没有就当连接已经断了。
  request.setTimeout(10 * 60_000, () => request.destroy(new Error("10 分钟没有数据，重连")));
  request.on("error", (error) => {
    if (!stream.stopped) stream.status.error = error.message;
  });
  request.on("close", () => {
    if (stream.request === request) stream.request = null;
    if (!stream.stopped) schedule(assetId, stream);
  });
  request.end();
}

function stop(assetId: string): void {
  const stream = streams().get(assetId);
  if (!stream) return;
  stream.stopped = true;
  if (stream.timer) clearTimeout(stream.timer);
  stream.request?.destroy();
  streams().delete(assetId);
}

/** 监控每轮调一次：该连的连上，不该连的（不再监控、删了、关了实时事件）断掉，地址或账号变了重连。 */
export function syncEventStreams(): void {
  const settings = getMonitorSettings();
  const wanted = new Map<string, Asset>();
  if (settings.enabled && settings.redfishEvents) {
    for (const asset of listAssets()) {
      if (asset.type === "server" && asset.bmcIp && assetBmcAccounts(asset).length && monitored(asset, settings)) wanted.set(asset.id, asset);
    }
  }
  for (const [assetId, stream] of streams()) {
    const asset = wanted.get(assetId);
    if (!asset || streamKey(asset) !== stream.key) stop(assetId);
  }
  for (const [assetId, asset] of wanted) {
    if (streams().has(assetId)) continue;
    const stream: Stream = { key: streamKey(asset), status: { state: "connecting", since: new Date().toISOString(), error: "", events: 0 }, request: null, timer: null, failures: 0, stopped: false };
    streams().set(assetId, stream);
    void connect(assetId, stream);
  }
}
