import http from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import zlib from "node:zlib";
import { authenticate, sameOrigin } from "./auth.ts";
import { bmcAccounts, getServer } from "./store.ts";

/**
 * 远程控制台：在控制台页面里嵌入某台服务器 BMC 的 KVM 画面（AMI H5Viewer）。
 *
 * nginx 把 /__bmc/<项目>/<服务器>/... 转到这里，这里再转给那台 BMC 的 https://<bmcIp>/...。
 * 和控制台同源，所以不用另开端口和窗口，控制台登录 cookie 直接拿来鉴权。
 * BMC 的会话（QSESSIONID 和 CSRF token）只留在小主机上，每次转发时补上，浏览器拿不到 BMC 账号密码。
 * BMC 的页面写死了从根路径加载资源和连 WebSocket，由注入的 shim.js 在浏览器里改成带前缀的路径。
 */

const PREFIX_RE = /^\/__bmc\/([0-9a-f-]{36})\/([0-9a-f-]{36})(\/.*)?$/;

export function bmcPrefix(projectId: string, serverId: string): string {
  return `/__bmc/${projectId}/${serverId}`;
}

export function parseBmcPath(pathname: string): { projectId: string; serverId: string; rest: string } | null {
  const match = PREFIX_RE.exec(pathname);
  return match ? { projectId: match[1], serverId: match[2], rest: match[3] || "/" } : null;
}

/** BMC 的网页端口。只有测试会改它。 */
function bmcPort(): number {
  return Number(process.env.PXE_KVM_BMC_PORT || 443);
}

const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false, maxSockets: 16 });

interface BmcSession {
  host: string;
  sid: string;
  csrf: string;
  user: string;
  privilege: number;
  extendedpriv: number;
  /** BMC 看到的小主机地址，用来认出哪些 KVM 会话是经代理开的。 */
  clientIp: string;
}

const sessions = new Map<string, Promise<BmcSession>>();

function call(host: string, options: https.RequestOptions, body?: Buffer): Promise<{ response: http.IncomingMessage; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const upstream = https.request({ host, port: bmcPort(), agent, timeout: 30_000, ...options }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ response, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("BMC 超时")));
    upstream.on("error", reject);
    upstream.end(body);
  });
}

/** 用服务器表里的账号登录 BMC 网页，改过账号的先用目标账号。 */
async function login(host: string, accounts: { user: string; password: string }[]): Promise<BmcSession> {
  for (const account of accounts) {
    const form = Buffer.from(new URLSearchParams({ username: account.user, password: account.password }).toString());
    const { response, body } = await call(host, {
      method: "POST",
      path: "/api/session",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": form.length },
    }, form);
    const sid = /QSESSIONID=([^;]+)/.exec([response.headers["set-cookie"] || []].flat().join(";"))?.[1];
    if (response.statusCode !== 200 || !sid) continue;
    const data = JSON.parse(body.toString("utf8")) as { CSRFToken?: string; privilege?: number; extendedpriv?: number; remote_addr?: string };
    return {
      host,
      sid,
      csrf: data.CSRFToken || "",
      user: account.user,
      privilege: data.privilege ?? 4,
      extendedpriv: data.extendedpriv ?? 3,
      clientIp: data.remote_addr || "",
    };
  }
  throw new Error("BMC 不接受服务器表里的账号密码");
}

/** 每个控制台用户、每台服务器共用一个 BMC 会话；BMC 回 401 时重新登录。 */
function session(key: string, host: string, accounts: { user: string; password: string }[], fresh = false): Promise<BmcSession> {
  const cached = sessions.get(key);
  if (cached && !fresh) {
    return cached.then((value) => (value.host === host ? value : session(key, host, accounts, true)));
  }
  const created = login(host, accounts);
  sessions.set(key, created);
  created.catch(() => sessions.delete(key));
  return created;
}

class SessionExpired extends Error {}

/** 每台 BMC 上经代理连着的 KVM 画面连接。 */
const liveKvm = new Map<string, Set<Duplex>>();

function liveCount(host: string): number {
  return liveKvm.get(host)?.size || 0;
}

/**
 * 结束这台 BMC 上由小主机开的、已经没人在看的 KVM 会话。
 * 浏览器关掉面板时只是断开 WebSocket，BMC 不知道 KVM 已经退出，会一直留着主控权到超时（30 分钟），
 * 下次打开就只拿到部分权限。只在经代理的 KVM 连接全部断开时调用，不动别人直接登录 BMC 开的会话。
 */
export async function closeStaleKvm(bmc: BmcSession): Promise<number> {
  const headers = { Cookie: `QSESSIONID=${bmc.sid}`, "X-CSRFTOKEN": bmc.csrf };
  const json = async (path: string) => {
    const { response, body } = await call(bmc.host, { method: "GET", path, headers });
    if (response.statusCode === 401) throw new SessionExpired();
    return response.statusCode === 200 ? JSON.parse(decode(body, response.headers["content-encoding"]).toString("utf8")) : null;
  };
  const services = (await json("/api/settings/services")) as { id: number; service_name: string }[] | null;
  const service = services?.find((item) => item.service_name === "kvm");
  if (!service) return 0;
  const list = ((await json(`/api/settings/service-sessions?service_id=${service.id}`)) || []) as { id: number; client_ip?: string }[];
  let closed = 0;
  for (const item of list) {
    if (!bmc.clientIp || item.client_ip !== bmc.clientIp) continue;
    const { response } = await call(bmc.host, { method: "DELETE", path: `/api/settings/service-sessions/${item.id}`, headers });
    if (response.statusCode === 200) closed += 1;
  }
  return closed;
}

/** 用这个用户保存的 BMC 会话清理；会话过期就重新登录一次。 */
async function closeStaleQuietly(target: { key: string; host: string; accounts: { user: string; password: string }[] }, label: string): Promise<void> {
  try {
    let count: number;
    try {
      count = await closeStaleKvm(await session(target.key, target.host, target.accounts));
    } catch (error) {
      if (!(error instanceof SessionExpired)) throw error;
      count = await closeStaleKvm(await session(target.key, target.host, target.accounts, true));
    }
    if (count) console.log(`[kvm] ${label}：结束了 ${target.host} 上 ${count} 个没人在看的 KVM 会话`);
  } catch (error) {
    console.error(`[kvm] 清理 ${target.host} 的 KVM 会话失败：${error instanceof Error ? error.message : error}`);
  }
}

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "x-real-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "cookie", "x-csrftoken", "authorization"]);

const CANONICAL: Record<string, string> = {
  "sec-websocket-key": "Sec-WebSocket-Key",
  "sec-websocket-version": "Sec-WebSocket-Version",
  "sec-websocket-protocol": "Sec-WebSocket-Protocol",
  "sec-websocket-extensions": "Sec-WebSocket-Extensions",
  "x-csrftoken": "X-CSRFTOKEN",
};

/** AMI 的 KVM 服务按大小写比对握手头，统一按浏览器的写法发：Host、Upgrade、Sec-WebSocket-Key…… */
export function canonicalHeaders(headers: http.OutgoingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    out[CANONICAL[lower] || lower.replace(/(^|-)([a-z])/g, (_, dash: string, letter: string) => `${dash}${letter.toUpperCase()}`)] = value;
  }
  return out;
}

/**
 * 发给 BMC 的请求头：浏览器的 cookie（控制台会话）不转发，换成小主机保存的 BMC 会话；
 * Host、Origin、Referer 改成 BMC 自己的地址，否则 BMC 的 CSRF 检查会拒绝。
 */
export function bmcRequestHeaders(
  headers: http.IncomingHttpHeaders,
  bmc: { host: string; sid: string; csrf: string },
  prefix: string,
  upgrade = false,
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || (HOP.has(name) && !(upgrade && (name === "connection" || name === "upgrade")))) continue;
    out[name] = value;
  }
  out.host = bmc.host;
  out.cookie = `QSESSIONID=${bmc.sid}`;
  if (bmc.csrf) out["x-csrftoken"] = bmc.csrf;
  if (headers.origin) out.origin = `https://${bmc.host}`;
  if (typeof headers.referer === "string") {
    try {
      const referer = new URL(headers.referer);
      const path = referer.pathname.startsWith(`${prefix}/`) ? referer.pathname.slice(prefix.length) : referer.pathname;
      out.referer = `https://${bmc.host}${path}${referer.search}`;
    } catch {
      delete out.referer;
    }
  }
  return canonicalHeaders(out);
}

/** HTML 里写死的根路径（src="/..."、data-main="/app/main"）加上前缀，最前面插入 shim.js。 */
export function rewriteHtml(html: string, prefix: string): string {
  const fixed = html.replace(/(\s(?:src|href|action|data-main)\s*=\s*["'])\/(?!\/)/gi, `$1${prefix}/`);
  const shim = `<script src="${prefix}/__pxe/shim.js"></script>`;
  return /<head[^>]*>/i.test(fixed) ? fixed.replace(/<head[^>]*>/i, (head) => `${head}${shim}`) : `${shim}${fixed}`;
}

export function rewriteCss(css: string, prefix: string): string {
  return css.replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${prefix}/`);
}

/**
 * 在 BMC 页面里最先运行：
 * - XHR、fetch、WebSocket、动态 <script>/<img>/<link> 的根路径和本机地址都加上前缀；
 * - document.cookie 换成内存里的一份（真正的 BMC 会话在小主机上），H5Viewer 在 HTTP 页面里写不了 __Host- cookie；
 * - H5Viewer 本来由 BMC 首页 window.open 打开，会读 window.opener 上的权限和开关，这里补一个替身。
 */
export function shimScript(input: { prefix: string; csrf: string; user: string; privilege: number; extendedpriv: number; features: string[] }): string {
  const has = (name: string) => input.features.includes(name);
  const constants = {
    CD_SERVER_APP_FLAG: has("CD_SERVER_APP"),
    HOST_CURSOR_ENABLED_FLAG: has("HOST_CURSOR_ENABLED_DEFAULT"),
    KVM_SESS_RECON_FLG: has("KVM_SESSION_RECONNECT"),
    VMEDIA_MAX_COUNT_FLAG: has("VMEDIA_MAX_COUNT_FOR_KVM"),
  };
  const kvm = input.extendedpriv & 1 ? 1 : 0;
  const vmedia = input.extendedpriv & 2 ? 1 : 0;
  return `(function () {
  var P = ${JSON.stringify(input.prefix)};
  function fix(u) {
    if (u == null) return u;
    var s = String(u);
    if (/^(data|blob|javascript|about):/i.test(s) || s.charAt(0) === "#") return u;
    if (s.charAt(0) === "/" && s.charAt(1) !== "/") return s === P || s.indexOf(P + "/") === 0 ? s : P + s;
    try {
      var x = new URL(s, location.href);
      if (x.hostname !== location.hostname) return u;
      if (x.pathname !== P && x.pathname.indexOf(P + "/") !== 0) x.pathname = P + x.pathname;
      x.host = location.host;
      if (location.protocol === "http:") x.protocol = x.protocol === "wss:" ? "ws:" : x.protocol === "https:" ? "http:" : x.protocol;
      else x.protocol = x.protocol === "ws:" ? "wss:" : x.protocol === "http:" ? "https:" : x.protocol;
      return x.toString();
    } catch (e) {
      return u;
    }
  }

  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = fix(url);
    return open.apply(this, args);
  };
  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      return nativeFetch.call(this, typeof input === "string" || input instanceof URL ? fix(input) : input, init);
    };
  }
  var NativeWebSocket = window.WebSocket;
  var PatchedWebSocket = function (url, protocols) {
    return protocols === undefined ? new NativeWebSocket(fix(url)) : new NativeWebSocket(fix(url), protocols);
  };
  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) { PatchedWebSocket[k] = NativeWebSocket[k]; });
  window.WebSocket = PatchedWebSocket;
  var nativeOpen = window.open;
  window.open = function (url) {
    var args = Array.prototype.slice.call(arguments);
    args[0] = fix(url);
    return nativeOpen.apply(window, args);
  };
  [[HTMLScriptElement, "src"], [HTMLImageElement, "src"], [HTMLLinkElement, "href"], [HTMLIFrameElement, "src"], [HTMLAnchorElement, "href"]].forEach(function (pair) {
    var desc = Object.getOwnPropertyDescriptor(pair[0].prototype, pair[1]);
    if (!desc || !desc.set) return;
    Object.defineProperty(pair[0].prototype, pair[1], {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (v) { desc.set.call(this, fix(v)); }
    });
  });
  var setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var lower = String(name).toLowerCase();
    return setAttribute.call(this, name, lower === "src" || lower === "href" || lower === "data-main" ? fix(value) : value);
  };

  var csrf = ${JSON.stringify(input.csrf)};
  var jar = { QSESSIONID: "pxe", garc: csrf, "__Host-garc": csrf };
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: function () { return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; "); },
    set: function (v) {
      var text = String(v), part = text.split(";")[0], at = part.indexOf("=");
      if (at < 1) return;
      var key = part.slice(0, at).trim();
      if (/expires=Thu, 01 Jan 1970|max-age=0/i.test(text)) {
        if (key !== "QSESSIONID" && !/garc$/.test(key)) delete jar[key];
      } else {
        jar[key] = part.slice(at + 1).trim();
      }
    }
  });

  window.privilege_id = ${input.privilege};
  window.kvm_access = ${kvm};
  window.vmedia_access = ${vmedia};
  var noop = { removeAttr: function () { return noop; }, attr: function () { return noop; } };
  try {
    window.opener = {
      CONSTANTS: ${JSON.stringify(constants)},
      privilege_id: ${input.privilege},
      kvm_access: ${kvm},
      vmedia_access: ${vmedia},
      $: function () { return noop; }
    };
  } catch (e) {}
  try {
    var seed = { privilege_id: "${input.privilege}", username: ${JSON.stringify(input.user)}, kvm_access: "${kvm}", vmedia_access: "${vmedia}" };
    Object.keys(seed).forEach(function (k) { sessionStorage.setItem(k, seed[k]); });
  } catch (e) {}
})();
`;
}

function page(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>远程控制台</title>` +
      `<body style="font-family:sans-serif;padding:2rem;max-width:40rem;color:#444"><p>${message}</p></body>`,
  );
}

function decode(body: Buffer, encoding: string | undefined): Buffer {
  if (encoding === "gzip") return zlib.gunzipSync(body);
  if (encoding === "deflate") return zlib.inflateSync(body);
  if (encoding === "br") return zlib.brotliDecompressSync(body);
  return body;
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("请求太大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

interface Resolved {
  prefix: string;
  rest: string;
  key: string;
  host: string;
  accounts: { user: string; password: string }[];
}

/** 控制台登录有效、写请求来自本站页面、服务器有 IPMI 地址和账号，才转发。 */
function resolve(req: http.IncomingMessage): Resolved | { status: number; message: string } {
  const url = new URL(req.url || "/", "http://x");
  const parsed = parseBmcPath(url.pathname);
  if (!parsed) return { status: 404, message: "地址不对。" };
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
  const identity = authenticate(headers);
  if (!identity) return { status: 401, message: "需要先登录 PXE 控制台。" };
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method || "GET") && !sameOrigin(headers)) return { status: 403, message: "跨站请求被拒绝。" };
  const row = getServer(parsed.projectId, parsed.serverId);
  if (!row?.bmcIp) return { status: 404, message: "这台服务器还没有 IPMI 地址。" };
  const accounts = bmcAccounts(row);
  if (!accounts.length) return { status: 404, message: "服务器表里没有这台的 IPMI 账号密码。" };
  return {
    prefix: bmcPrefix(parsed.projectId, parsed.serverId),
    rest: `${parsed.rest}${url.search}`,
    key: `${identity.user.id}:${row.id}`,
    host: row.bmcIp,
    accounts,
  };
}

async function features(bmc: BmcSession): Promise<string[]> {
  try {
    const { response, body } = await call(bmc.host, {
      method: "GET",
      path: "/api/configuration/project",
      headers: { Cookie: `QSESSIONID=${bmc.sid}`, "X-CSRFTOKEN": bmc.csrf },
    });
    if (response.statusCode !== 200) return [];
    const list = JSON.parse(decode(body, response.headers["content-encoding"]).toString("utf8")) as { feature?: string }[];
    return Array.isArray(list) ? list.map((item) => String(item.feature || "")) : [];
  } catch {
    return [];
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const target = resolve(req);
  if ("status" in target) {
    page(res, target.status, target.message);
    return;
  }
  const method = req.method || "GET";
  const path = target.rest.split("?")[0];

  if (path === "/") {
    res.writeHead(302, { Location: `${target.prefix}/viewer.html`, "Cache-Control": "no-store" });
    res.end();
    return;
  }

  let bmc = await session(target.key, target.host, target.accounts);

  if (path === "/__pxe/shim.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(shimScript({ prefix: target.prefix, csrf: bmc.csrf, user: bmc.user, privilege: bmc.privilege, extendedpriv: bmc.extendedpriv, features: await features(bmc) }));
    return;
  }
  // 会话留给同一用户的其他窗口；BMC 那边过期后下次请求会自动重新登录。
  if (method === "DELETE" && path === "/api/session") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{ "ok": 0 }');
    return;
  }

  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req, 64 * 1024 * 1024);
  const send = (current: BmcSession) => {
    const headers = bmcRequestHeaders(req.headers, current, target.prefix);
    if (body) headers["Content-Length"] = body.length;
    return call(current.host, { method, path: target.rest, headers }, body);
  };
  let answer = await send(bmc);
  if (answer.response.statusCode === 401) {
    bmc = await session(target.key, target.host, target.accounts, true);
    answer = await send(bmc);
  }

  const { response } = answer;
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined || ["connection", "keep-alive", "transfer-encoding", "set-cookie", "content-length"].includes(name)) continue;
    out[name] = value;
  }
  if (typeof response.headers.location === "string") {
    const location = response.headers.location.replace(new RegExp(`^https?://${target.host.replace(/\./g, "\\.")}(:\\d+)?`), "");
    out.location = location.startsWith("/") ? `${target.prefix}${location}` : location;
  }
  let payload = answer.body;
  const type = String(response.headers["content-type"] || "");
  if (/text\/html|text\/css/.test(type) && payload.length) {
    const text = decode(payload, response.headers["content-encoding"]).toString("utf8");
    payload = Buffer.from(type.includes("css") ? rewriteCss(text, target.prefix) : rewriteHtml(text, target.prefix));
    delete out["content-encoding"];
    delete out.etag;
  }
  out["content-length"] = payload.length;
  res.writeHead(response.statusCode || 502, out);
  res.end(method === "HEAD" ? undefined : payload);
}

/** KVM 画面（/kvm）和虚拟光驱（/cd-server）走 WebSocket，握手后两边直接对接。 */
function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
  socket.on("error", () => socket.destroy());
  const target = resolve(req);
  if ("status" in target) {
    socket.end(`HTTP/1.1 ${target.status} Refused\r\nConnection: close\r\n\r\n`);
    return;
  }
  const isKvm = target.rest.split("?")[0] === "/kvm";
  // 没人经代理在看这台时，先清掉上次留下的 KVM 会话，新开的才能拿到完整权限。
  (isKvm && !liveCount(target.host) ? closeStaleQuietly(target, "打开前") : Promise.resolve())
    .then(() => session(target.key, target.host, target.accounts))
    .then((bmc) => {
      const upstream = https.request({
        host: target.host,
        port: bmcPort(),
        method: req.method,
        path: target.rest,
        headers: bmcRequestHeaders(req.headers, bmc, target.prefix, true),
        rejectUnauthorized: false,
        agent: false,
      });
      upstream.on("upgrade", (response, bmcSocket, bmcHead) => {
        const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
        for (let i = 0; i < response.rawHeaders.length; i += 2) lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
        socket.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (bmcHead.length) socket.write(bmcHead);
        if (head.length) bmcSocket.write(head);
        bmcSocket.on("error", () => socket.destroy());
        socket.on("close", () => bmcSocket.destroy());
        bmcSocket.on("close", () => socket.destroy());
        bmcSocket.pipe(socket).pipe(bmcSocket);
        if (isKvm) {
          const live = liveKvm.get(target.host) || new Set<Duplex>();
          live.add(socket);
          liveKvm.set(target.host, live);
          socket.once("close", () => {
            live.delete(socket);
            // 关掉面板就退出 KVM。稍等一下，页面刷新或断线重连时不要误杀。
            setTimeout(() => {
              if (!liveCount(target.host)) void closeStaleQuietly(target, "关闭后");
            }, 3000);
          });
        }
      });
      upstream.on("response", (response) => {
        if (response.statusCode === 401) sessions.delete(target.key);
        socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);
        response.resume();
      });
      upstream.on("error", () => socket.destroy());
      upstream.end();
    })
    .catch(() => socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"));
}

export function createKvmProxy(): http.Server {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      page(res, 502, `连接 BMC 失败：${error instanceof Error ? error.message : "未知错误"}`);
    });
  });
  server.on("upgrade", handleUpgrade);
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  return server;
}

declare global {
  var pxeKvmProxy: http.Server | undefined;
}

/** 由 instrumentation.ts 在控制台启动时调用一次。nginx 把 /__bmc/ 转到这里。 */
export function startKvmProxy(): void {
  if (globalThis.pxeKvmProxy) return;
  const port = Number(process.env.PXE_KVM_PROXY_PORT || 3001);
  const host = process.env.HOSTNAME || "0.0.0.0";
  const server = createKvmProxy();
  server.on("error", (error) => console.error(`[kvm] 代理没能监听 ${host}:${port}：${error.message}`));
  server.listen(port, host, () => console.log(`[kvm] 远程控制台代理监听 ${host}:${port}`));
  globalThis.pxeKvmProxy = server;
}
