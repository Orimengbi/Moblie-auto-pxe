import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import zlib from "node:zlib";
import { getUser, signPayload, verifyPayload } from "./auth.ts";
import { bmcAccounts, getServer } from "./store.ts";

/**
 * 远程控制台：把某台服务器 BMC 的网页、KVM 和虚拟介质 WebSocket 原样转发给浏览器。
 * nginx 在 HTTPS 443 上终结 TLS 后转到这里（BMC 的网页和 H5Viewer 只在 HTTPS 下正常工作）。
 * 浏览器只拿到一张签名 cookie 说明要看哪台机器；BMC 账号密码留在小主机上：
 * 登录请求经过这里时把表单里的用户名密码换成服务器表里的账号。
 */

export const KVM_COOKIE = "pxe_kvm";
const TICKET_SECONDS = 60;
const COOKIE_SECONDS = 12 * 3600;

interface KvmClaims {
  t: "kvm-open" | "kvm";
  p: string;
  s: string;
  u: string;
  v: number;
  n: string;
  e: number;
}

export interface KvmTarget {
  host: string;
  sn: string;
  accounts: { user: string; password: string }[];
}

/** 控制台按钮换来的一次性票据，60 秒内有效，打开后换成 cookie。 */
export function kvmTicket(projectId: string, serverId: string, user: { id: string; version: number }): string {
  return signPayload({
    t: "kvm-open",
    p: projectId,
    s: serverId,
    u: user.id,
    v: user.version,
    n: crypto.randomBytes(8).toString("base64url"),
    e: Math.floor(Date.now() / 1000) + TICKET_SECONDS,
  } satisfies KvmClaims);
}

const usedTickets = new Map<string, number>();

/** 票据或 cookie 有效、用户仍然启用且没改过密码，才给出要转发的 BMC。 */
export function resolveClaims(token: string, type: KvmClaims["t"]): { claims: KvmClaims; target: KvmTarget } | null {
  const claims = verifyPayload<KvmClaims>(token);
  if (!claims || claims.t !== type || claims.e < Date.now() / 1000) return null;
  const user = getUser(claims.u);
  if (!user || user.disabled || user.version !== claims.v) return null;
  const row = getServer(claims.p, claims.s);
  if (!row?.bmcIp) return null;
  const accounts = bmcAccounts(row);
  if (!accounts.length) return null;
  return { claims, target: { host: row.bmcIp, sn: row.sn, accounts } };
}

export function consumeTicket(token: string): { cookie: string; target: KvmTarget } | null {
  const resolved = resolveClaims(token, "kvm-open");
  if (!resolved) return null;
  const now = Date.now() / 1000;
  for (const [nonce, expires] of usedTickets) if (expires < now) usedTickets.delete(nonce);
  if (usedTickets.has(resolved.claims.n)) return null;
  usedTickets.set(resolved.claims.n, resolved.claims.e);
  const cookie = signPayload({ ...resolved.claims, t: "kvm", e: Math.floor(now) + COOKIE_SECONDS } satisfies KvmClaims);
  return { cookie, target: resolved.target };
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return cookies;
}

/** 转给 BMC 的 cookie 去掉控制台自己的（pxe_ 开头），不把会话交给 BMC。 */
export function bmcCookieHeader(header: string | undefined): string {
  return [...parseCookies(header)]
    .filter(([name]) => !name.startsWith("pxe_"))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** 登录表单里的用户名密码换成服务器表里的账号，其他字段原样保留。 */
export function substituteLogin(body: string, account: { user: string; password: string }): string {
  const form = new URLSearchParams(body);
  form.set("username", account.user);
  form.set("password", account.password);
  return form.toString();
}

export function injectAutologin(html: string): string {
  const tag = '<script src="/__pxe/autologin.js"></script>';
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : `${html}${tag}`;
}

/** 在 BMC 登录页自动填用户名并点登录。密码随便填，经过代理时会被换掉。最多试两次，免得来回跳。 */
export function autologinScript(user: string): string {
  return `(function () {
  var user = ${JSON.stringify(user)};
  var key = "pxe_autologin";
  var tries = 0;
  function visible(el) { return el && el.offsetParent !== null; }
  function attempt() {
    var id = document.getElementById("userid");
    var pw = document.getElementById("password");
    var btn = document.getElementById("btn-login");
    if (visible(id) && visible(pw) && visible(btn)) {
      var n = Number(sessionStorage.getItem(key) || 0);
      if (n >= 2) return;
      sessionStorage.setItem(key, String(n + 1));
      id.value = user;
      pw.value = "pxe-proxy";
      ["input", "change", "keyup"].forEach(function (type) {
        id.dispatchEvent(new Event(type, { bubbles: true }));
        pw.dispatchEvent(new Event(type, { bubbles: true }));
      });
      btn.click();
      return;
    }
    if (++tries < 80) setTimeout(attempt, 250);
    else sessionStorage.removeItem(key);
  }
  attempt();
})();
`;
}

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "x-real-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]);

/** 发给 BMC 的请求头：Host、Origin、Referer 都改成 BMC 自己的地址，否则 BMC 的 CSRF 检查会拒绝。 */
export function bmcRequestHeaders(headers: http.IncomingHttpHeaders, host: string, keepUpgrade = false): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || (HOP.has(name) && !(keepUpgrade && (name === "connection" || name === "upgrade")))) continue;
    out[name] = value;
  }
  out.host = host;
  const cookie = bmcCookieHeader(headers.cookie);
  if (cookie) out.cookie = cookie;
  else delete out.cookie;
  if (headers.origin) out.origin = `https://${host}`;
  if (typeof headers.referer === "string") {
    try {
      const referer = new URL(headers.referer);
      out.referer = `https://${host}${referer.pathname}${referer.search}`;
    } catch {
      delete out.referer;
    }
  }
  return out;
}

const CANONICAL: Record<string, string> = {
  "sec-websocket-key": "Sec-WebSocket-Key",
  "sec-websocket-version": "Sec-WebSocket-Version",
  "sec-websocket-protocol": "Sec-WebSocket-Protocol",
  "sec-websocket-extensions": "Sec-WebSocket-Extensions",
};

/**
 * AMI 的 KVM 服务按大小写比对握手头，Node 发出的小写 upgrade/connection 会被回 404。
 * WebSocket 握手按浏览器的写法发：Host、Upgrade、Sec-WebSocket-Key……
 */
export function canonicalHeaders(headers: http.OutgoingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    out[CANONICAL[lower] || lower.replace(/(^|-)([a-z])/g, (_, dash: string, letter: string) => `${dash}${letter.toUpperCase()}`)] = value;
  }
  return out;
}

function page(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>远程控制台</title><body style="font-family:sans-serif;padding:2rem;max-width:40rem">` +
      `<h1 style="font-size:1.25rem">远程控制台</h1><p>${message}</p><p>请回到 PXE 控制台，在项目的服务器列表里点「远程控制台」重新打开。</p></body>`,
  );
}

/** BMC 的网页端口。只有测试会改它。 */
function bmcPort(): number {
  return Number(process.env.PXE_KVM_BMC_PORT || 443);
}

const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false, maxSockets: 16 });

function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<Buffer> {
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

function request(target: KvmTarget, options: https.RequestOptions, body?: Buffer): Promise<{ response: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const upstream = https.request({ host: target.host, port: bmcPort(), agent, timeout: 60_000, ...options }, (response) => resolve({ response }));
    upstream.on("timeout", () => upstream.destroy(new Error("BMC 超时")));
    upstream.on("error", reject);
    upstream.end(body);
  });
}

function collect(response: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", reject);
  });
}

function decode(body: Buffer, encoding: string | undefined): Buffer {
  if (encoding === "gzip") return zlib.gunzipSync(body);
  if (encoding === "deflate") return zlib.inflateSync(body);
  if (encoding === "br") return zlib.brotliDecompressSync(body);
  return body;
}

/** BMC 的 Location 如果写了自己的地址，改成相对地址，留在代理里。 */
function responseHeaders(headers: http.IncomingHttpHeaders, host: string): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === "connection" || name === "keep-alive" || name === "transfer-encoding") continue;
    out[name] = value;
  }
  if (typeof headers.location === "string") out.location = headers.location.replace(new RegExp(`^https?://${host.replace(/\./g, "\\.")}(:\\d+)?`), "");
  return out;
}

function currentTarget(req: http.IncomingMessage): KvmTarget | null {
  const token = parseCookies(req.headers.cookie).get(KVM_COOKIE);
  return token ? resolveClaims(token, "kvm")?.target || null : null;
}

/** 本次 BMC 登录实际用的账号，自动登录脚本按它填用户名。 */
const lastAccount = new Map<string, string>();

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", "https://kvm.invalid");

  if (url.pathname === "/__pxe/open") {
    const opened = consumeTicket(url.searchParams.get("t") || "");
    if (!opened) {
      page(res, 403, "链接已失效或已经用过。");
      return;
    }
    // 换一台机器时清掉上一台 BMC 留下的 cookie，否则新 BMC 会拿到旧会话。
    const clear = [...parseCookies(req.headers.cookie).keys()]
      .filter((name) => !name.startsWith("pxe_"))
      .map((name) => `${name}=; Path=/; Max-Age=0${name.startsWith("__Host-") || name.startsWith("__Secure-") ? "; Secure" : ""}`);
    res.writeHead(302, {
      location: "/",
      "cache-control": "no-store",
      "set-cookie": [`${KVM_COOKIE}=${opened.cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_SECONDS}`, ...clear],
    });
    res.end();
    return;
  }

  const target = currentTarget(req);
  if (!target) {
    page(res, 401, "没有打开任何服务器，或者打开的链接已过期。");
    return;
  }

  if (url.pathname === "/__pxe/autologin.js") {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    res.end(autologinScript(lastAccount.get(target.host) || target.accounts[0].user));
    return;
  }

  const headers = bmcRequestHeaders(req.headers, target.host);
  const method = req.method || "GET";

  if (method === "POST" && url.pathname === "/api/session") {
    const original = (await readBody(req)).toString("utf8");
    let answer: http.IncomingMessage | null = null;
    let body: Buffer = Buffer.alloc(0);
    for (const account of target.accounts) {
      const form = Buffer.from(substituteLogin(original, account));
      answer = (await request(target, { method, path: req.url, headers: { ...headers, "content-length": form.length } }, form)).response;
      body = await collect(answer);
      if (answer.statusCode === 200) {
        lastAccount.set(target.host, account.user);
        break;
      }
    }
    if (!answer) throw new Error("没有可用的 BMC 账号");
    console.log(`[kvm] 登录 ${target.sn} 的 BMC ${target.host}：${answer.statusCode}`);
    res.writeHead(answer.statusCode || 502, responseHeaders(answer.headers, target.host));
    res.end(body);
    return;
  }

  const isIndex = method === "GET" && (url.pathname === "/" || url.pathname === "/index.html");
  if (isIndex) headers["accept-encoding"] = "gzip";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req, 256 * 1024 * 1024);
  if (body) headers["content-length"] = body.length;
  const { response } = await request(target, { method, path: req.url, headers }, body);
  const outHeaders = responseHeaders(response.headers, target.host);

  if (isIndex && response.statusCode === 200 && String(response.headers["content-type"] || "text/html").includes("html")) {
    const html = injectAutologin(decode(await collect(response), response.headers["content-encoding"]).toString("utf8"));
    delete outHeaders["content-encoding"];
    delete outHeaders.etag;
    outHeaders["content-length"] = Buffer.byteLength(html);
    outHeaders["cache-control"] = "no-store";
    res.writeHead(200, outHeaders);
    res.end(html);
    return;
  }
  res.writeHead(response.statusCode || 502, outHeaders);
  response.pipe(res);
}

/** KVM 画面（/kvm）和虚拟光驱（/cd-server）走 WebSocket，握手后两边直接对接。 */
function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
  const target = currentTarget(req);
  socket.on("error", () => socket.destroy());
  if (!target) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  const upstream = https.request({
    host: target.host,
    port: bmcPort(),
    method: req.method,
    path: req.url,
    headers: canonicalHeaders(bmcRequestHeaders(req.headers, target.host, true)),
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
  });
  upstream.on("response", (response) => {
    socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);
    response.resume();
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
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

/** 由 instrumentation.ts 在控制台启动时调用一次。 */
export function startKvmProxy(): void {
  if (globalThis.pxeKvmProxy) return;
  const port = Number(process.env.PXE_KVM_PROXY_PORT || 3001);
  const host = process.env.HOSTNAME || "0.0.0.0";
  const server = createKvmProxy();
  server.on("error", (error) => console.error(`[kvm] 代理没能监听 ${host}:${port}：${error.message}`));
  server.listen(port, host, () => console.log(`[kvm] 远程控制台代理监听 ${host}:${port}`));
  globalThis.pxeKvmProxy = server;
}
