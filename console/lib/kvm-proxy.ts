import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { Duplex } from "node:stream";
import zlib from "node:zlib";
import { BmcAgent } from "./bmc-tls.ts";
import { authenticate, clientAddress, sameOrigin } from "./auth.ts";
import { assetBmcAccounts, audit, getAsset } from "./assets.ts";
import { permissionLabel, type Permission } from "./roles.ts";

/**
 * 远程控制台：在控制台页面里嵌入某台服务器 BMC 的 KVM 画面。AMI 用 BMC 自己的 H5Viewer；
 * OpenBMC（Quanta D75H 这类）用代理自己的查看页加 noVNC，只转 /kvm/0 这一个 WebSocket，见 openBmcViewer。
 *
 * nginx 把 /__bmc/<资产>/... 转到这里，这里再转给那台 BMC 的 https://<bmcIp>/...。
 * 和控制台同源，所以不用另开端口和窗口，控制台登录 cookie 直接拿来鉴权。
 * BMC 的会话（QSESSIONID 和 CSRF token）只留在小主机上，每次转发时补上，浏览器拿不到 BMC 账号密码。
 * BMC 的页面写死了从根路径加载资源和连 WebSocket，由注入的 shim.js 在浏览器里改成带前缀的路径。
 */

const PREFIX_RE = /^\/__bmc\/([0-9a-f-]{36})(\/.*)?$/;

export function bmcPrefix(assetId: string): string {
  return `/__bmc/${assetId}`;
}

export function parseBmcPath(pathname: string): { assetId: string; rest: string } | null {
  const match = PREFIX_RE.exec(pathname);
  return match ? { assetId: match[1], rest: match[2] || "/" } : null;
}

/** BMC 的网页端口。只有测试会改它。 */
function bmcPort(): number {
  return Number(process.env.PXE_KVM_BMC_PORT || 443);
}

const agent = new BmcAgent({ keepAlive: true, maxSockets: 16 });
/** WebSocket 升级用的连接不复用，升级后就从 Agent 里摘出去。 */
const upgradeAgent = new BmcAgent();

/** AMI MegaRAC（技嘉等）还是 OpenBMC（bmcweb，Quanta 等）。两边的网页登录和 KVM 完全不一样。 */
export type BmcKind = "ami" | "openbmc";

interface BmcSession {
  host: string;
  kind: BmcKind;
  /** AMI 的 QSESSIONID。 */
  sid: string;
  /** 转发时带的 Cookie。 */
  cookie: string;
  /** AMI 的 CSRF token；OpenBMC 的 XSRF token，KVM 的 WebSocket 子协议也用它。 */
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

/** 登录失败的原因不同，提示也不同：密码不对、BMC 网页服务没起来、连不上，不要都说成密码不对。 */
export function loginFailure(host: string, results: { status: number | null; error?: string }[]): string {
  if (results.some((item) => item.status === 401 || item.status === 403 || item.status === 200)) return `BMC ${host} 不接受资产里的账号密码`;
  const server = results.find((item) => item.status !== null && item.status >= 500);
  if (server) {
    return `BMC ${host} 的网页服务没有响应（HTTP ${server.status}），不是密码问题。BMC 刚重启时要等几分钟；一直这样可以对 BMC 做一次冷重启（ipmitool mc reset cold，不影响服务器系统）`;
  }
  const failed = results.find((item) => item.error);
  if (failed) return `连不上 BMC ${host} 的网页（${failed.error}）`;
  return `BMC ${host} 的网页登录没有成功（HTTP ${results.map((item) => item.status).join("、")}）`;
}

const kinds = new Map<string, { at: number; kind: Promise<BmcKind> }>();

/**
 * 不带账号判断是哪种 BMC，免得同一个密码在两种登录接口上各错一次、把账号锁住。
 * OpenBMC 的 /login 对空请求回 400，AMI 没有这个接口（404）。按地址和端口缓存一小时；连不上时报错、不缓存，
 * 免得 BMC 刚好宕着的时候被记成 AMI。
 */
export function detectKind(host: string): Promise<BmcKind> {
  const key = `${host}:${bmcPort()}`;
  const hit = kinds.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.kind;
  const body = Buffer.from("{}");
  const kind = call(host, { method: "POST", path: "/login", headers: { "Content-Type": "application/json", "Content-Length": body.length } }, body).then(
    ({ response }) => (response.statusCode === 400 ? "openbmc" : "ami") as BmcKind,
  );
  kinds.set(key, { at: Date.now(), kind });
  kind.catch(() => kinds.delete(key));
  return kind;
}

/** 用资产上的账号登录 BMC 网页，主账号不行再试备用账号。 */
async function login(host: string, accounts: { user: string; password: string }[]): Promise<BmcSession> {
  const kind = await detectKind(host).catch((error: unknown) => {
    throw new Error(loginFailure(host, [{ status: null, error: error instanceof Error ? error.message : "连接失败" }]));
  });
  if (kind === "openbmc") return loginOpenBmc(host, accounts);
  const results: { status: number | null; error?: string }[] = [];
  for (const account of accounts) {
    const form = Buffer.from(new URLSearchParams({ username: account.user, password: account.password }).toString());
    let reply: Awaited<ReturnType<typeof call>>;
    try {
      reply = await call(host, {
        method: "POST",
        path: "/api/session",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": form.length },
      }, form);
    } catch (error) {
      results.push({ status: null, error: error instanceof Error ? error.message : "连接失败" });
      break;
    }
    const { response, body } = reply;
    const sid = /QSESSIONID=([^;]+)/.exec([response.headers["set-cookie"] || []].flat().join(";"))?.[1];
    results.push({ status: response.statusCode ?? null });
    if (response.statusCode !== 200 || !sid) {
      // 网页服务没起来时换账号也没用，别白白多试一次。
      if ((response.statusCode ?? 0) >= 500) break;
      continue;
    }
    const data = JSON.parse(body.toString("utf8")) as { CSRFToken?: string; privilege?: number; extendedpriv?: number; remote_addr?: string };
    return {
      host,
      kind: "ami",
      sid,
      cookie: `QSESSIONID=${sid}`,
      csrf: data.CSRFToken || "",
      user: account.user,
      privilege: data.privilege ?? 4,
      extendedpriv: data.extendedpriv ?? 3,
      clientIp: data.remote_addr || "",
    };
  }
  throw new Error(loginFailure(host, results));
}

/** OpenBMC：POST /login {"data":[用户, 密码]}，回 BMCWEB-SESSION 和 XSRF-TOKEN 两个 cookie。 */
async function loginOpenBmc(host: string, accounts: { user: string; password: string }[]): Promise<BmcSession> {
  const results: { status: number | null; error?: string }[] = [];
  for (const account of accounts) {
    const form = Buffer.from(JSON.stringify({ data: [account.user, account.password] }));
    let reply: Awaited<ReturnType<typeof call>>;
    try {
      reply = await call(host, { method: "POST", path: "/login", headers: { "Content-Type": "application/json", "Content-Length": form.length } }, form);
    } catch (error) {
      results.push({ status: null, error: error instanceof Error ? error.message : "连接失败" });
      break;
    }
    const { response, body } = reply;
    results.push({ status: response.statusCode ?? null });
    if (response.statusCode !== 200) {
      if ((response.statusCode ?? 0) >= 500) break;
      continue;
    }
    const pairs = [response.headers["set-cookie"] || []].flat().map((item) => item.split(";")[0].trim()).filter((item) => item.includes("="));
    // KVM 子协议要的是 XSRF-TOKEN cookie 的值（BMC 网页自己也这么用）。Quanta 的 body 里另有一个 token，和它不一样，拿它连 KVM 会 401。
    let token = pairs.find((item) => item.startsWith("XSRF-TOKEN="))?.slice("XSRF-TOKEN=".length) || "";
    if (!token) {
      try {
        token = (JSON.parse(body.toString("utf8")) as { token?: string }).token || "";
      } catch {
        // body 不是 JSON 就只能靠 cookie。
      }
    }
    if (!pairs.length || !token) continue;
    return { host, kind: "openbmc", sid: "", cookie: pairs.join("; "), csrf: token, user: account.user, privilege: 4, extendedpriv: 3, clientIp: "" };
  }
  throw new Error(loginFailure(host, results));
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

/** BMC 上能改任何东西的那几项。认不出来的写接口要全有，相当于只给管理员。 */
const BMC_ADMIN: Permission[] = ["bmc.settings", "bmc.users", "firmware", "bios", "logs.clear"];

/** BMC 网页写接口要什么权限点，按顺序对第一条。 */
const BMC_WRITES: [RegExp, Permission[]][] = [
  [/^\/api\/kvm(\/.*)?$/, ["console"]],
  [/^\/api\/actions\/power(\/.*)?$/, ["power"]],
  [/^\/api\/(settings\/)?v?media(\/.*)?$/, ["media"]],
  [/^\/api\/settings\/users(\/.*)?$/, ["bmc.users"]],
  [/^\/api\/(settings\/)?bios(\/.*)?$/, ["bios"]],
  [/^\/api\/maintenance\/.*(firmware|fwimage|flash|fwupdate)/, ["firmware"]],
  [/^\/api\/logs(\/.*)?$/, ["logs.clear"]],
];

/**
 * 经代理调 BMC 要什么权限点。代理拿资产上的 BMC 账号（一般是管理员）登录，BMC 自己分不出是控制台的哪个用户，
 * 所以在这里按控制台的权限点拦：KVM 画面只要「远程控制台」，开关机要「电源和引导」，挂 ISO 要「虚拟介质」，
 * 改 BMC 用户、BIOS、固件、清日志要各自的权限点；认不出来的写接口和 WebSocket 一律要 BMC_ADMIN 全有。
 * 读（GET）只要「远程控制台」。
 */
export function bmcPermissions(method: string, path: string, upgrade = false): Permission[] {
  if (upgrade) {
    if (path === "/kvm" || path === "/kvm/0") return ["console"];
    if (/^\/(cd|hd|fd)-server$|^\/vmedia/.test(path)) return ["media"];
    return BMC_ADMIN;
  }
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return ["console"];
  // 查看器退出时注销会话，代理自己回，不转给 BMC。
  if (method.toUpperCase() === "DELETE" && path === "/api/session") return ["console"];
  for (const [re, permissions] of BMC_WRITES) if (re.test(path)) return permissions;
  return BMC_ADMIN;
}

/** 缺哪几个权限点，都有返回 null。 */
function missing(own: Permission[], needed: Permission[]): string | null {
  const lack = needed.filter((permission) => !own.includes(permission));
  return lack.length ? `需要${lack.map((permission) => `「${permissionLabel(permission)}」`).join("")}权限` : null;
}

/**
 * 发给 BMC 的请求头：浏览器的 cookie（控制台会话）不转发，换成小主机保存的 BMC 会话；
 * Host、Origin、Referer 改成 BMC 自己的地址，否则 BMC 的 CSRF 检查会拒绝。
 */
export function bmcRequestHeaders(
  headers: http.IncomingHttpHeaders,
  bmc: { host: string; sid: string; csrf: string; cookie?: string },
  prefix: string,
  upgrade = false,
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || (HOP.has(name) && !(upgrade && (name === "connection" || name === "upgrade")))) continue;
    out[name] = value;
  }
  out.host = bmc.host;
  out.cookie = bmc.cookie || `QSESSIONID=${bmc.sid}`;
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

/**
 * BMC 的页面带 X-Frame-Options: SAMEORIGIN。画面嵌在控制台页面里，控制台和 /__bmc/ 端口不同，算两个源，
 * 浏览器会拒绝显示。代理去掉这个头，改成只许同一主机（任何端口）的页面嵌入，别的网站还是嵌不了。
 */
export function frameAncestors(host: string | undefined): string {
  if (!host) return "";
  try {
    const name = new URL(`http://${host}`).hostname;
    return `frame-ancestors http://${name}:* https://${name}:*`;
  } catch {
    return "";
  }
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
export function shimScript(input: { prefix: string; csrf: string; user: string; privilege: number; extendedpriv: number; features: string[]; media?: boolean }): string {
  const has = (name: string) => input.features.includes(name);
  const constants = {
    CD_SERVER_APP_FLAG: has("CD_SERVER_APP"),
    HOST_CURSOR_ENABLED_FLAG: has("HOST_CURSOR_ENABLED_DEFAULT"),
    KVM_SESS_RECON_FLG: has("KVM_SESSION_RECONNECT"),
    VMEDIA_MAX_COUNT_FLAG: has("VMEDIA_MAX_COUNT_FOR_KVM"),
  };
  const kvm = input.extendedpriv & 1 ? 1 : 0;
  // 没有「虚拟介质」权限的用户不显示挂载按钮；真正拦的是代理（/cd-server 要这个权限点）。
  const vmedia = input.extendedpriv & 2 && input.media !== false ? 1 : 0;
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
    // H5Viewer 卸载时写 reloaded=1，下次打开看到就只弹「窗口已重新加载，请重新启动」然后停住。
    // 它本来在独立弹窗里，关窗就清了；嵌在页面里和控制台共用这个标签页的 sessionStorage，
    // 刷新过一次查看器以后，这个标签页里再开哪台都打不开。每次打开前清掉。
    sessionStorage.removeItem("reloaded");
  } catch (e) {}
})();
`;
}

/**
 * OpenBMC 的查看页：只有 KVM 画面，用 noVNC 经代理连 /kvm/0。不转 BMC 自己的网页（单页应用，路径写死在根上，
 * 而且转了就等于把管理员会话下的整个 BMC 网页交出去）。noVNC 的文件也由代理发，正式环境不通外网。
 */
export function openBmcViewer(prefix: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>远程控制台</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#screen{width:100%;height:100%}
#status{position:fixed;top:8px;left:8px;color:#ddd;font:13px/1.5 sans-serif;background:rgba(0,0,0,.7);padding:4px 10px;border-radius:4px;max-width:80%}</style>
</head><body><div id="screen"></div><div id="status">正在连接 KVM…</div>
<script type="module">
import RFB from ${JSON.stringify(`${prefix}/__pxe/novnc/core/rfb.js`)};
const status = document.getElementById("status");
const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + ${JSON.stringify(`${prefix}/kvm/0`)};
const rfb = new RFB(document.getElementById("screen"), url, { wsProtocols: ["binary"] });
rfb.scaleViewport = true;
rfb.background = "#000";
rfb.addEventListener("connect", () => { status.style.display = "none"; rfb.focus(); });
rfb.addEventListener("disconnect", (event) => {
  status.style.display = "";
  status.textContent = event.detail.clean ? "KVM 已断开，点上面的「重新连接」" : "KVM 连接断了：BMC 没回应，或者 KVM 正被别人占着。点上面的「重新连接」再试";
});
rfb.addEventListener("credentialsrequired", () => { status.textContent = "BMC 要 VNC 密码，暂不支持"; });
</script></body></html>
`;
}

/** noVNC 的目录：正式镜像里在 /app/novnc（Dockerfile 拷进去），开发和测试时在 node_modules。 */
function novncDir(): string {
  const candidates = [process.env.PXE_NOVNC_DIR, path.join(process.cwd(), "novnc"), path.join(process.cwd(), "node_modules", "@novnc", "novnc")];
  return candidates.find((dir) => dir && fs.existsSync(path.join(dir, "core", "rfb.js"))) || "";
}

/** 发 noVNC 的一个脚本文件，只给 core/、vendor/ 下的 .js。 */
function sendNovnc(res: http.ServerResponse, file: string): void {
  const dir = novncDir();
  const clean = path.posix.normalize(file);
  const full = dir && /^(core|vendor)\/[A-Za-z0-9_\-./]+\.js$/.test(clean) && !clean.includes("..") ? path.join(dir, clean) : "";
  if (!full || !fs.existsSync(full)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(dir ? "没有这个文件" : "控制台里没有 noVNC，重新构建镜像");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" });
  fs.createReadStream(full).pipe(res);
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
  /** 控制台用户的权限点，转发前按 bmcPermissions 查。 */
  permissions: Permission[];
  actor: string;
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
  if (!identity.permissions.includes("console")) return { status: 403, message: "需要「远程控制台」权限。" };
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method || "GET") && !sameOrigin(headers)) return { status: 403, message: "跨站请求被拒绝。" };
  const row = getAsset(parsed.assetId);
  if (!row?.bmcIp) return { status: 404, message: "这台资产还没有 BMC 地址。" };
  const accounts = assetBmcAccounts(row);
  if (!accounts.length) return { status: 404, message: "资产里没有这台的 BMC 账号密码。" };
  if ((req.method || "GET") === "GET" && parsed.rest === "/viewer.html") {
    audit({ actor: identity.user.username, ip: clientAddress(headers), action: "打开远程控制台", targetType: "asset", targetId: row.id, targetLabel: `${row.tag} ${row.sn}`, detail: `BMC ${row.bmcIp}` });
  }
  return {
    prefix: bmcPrefix(parsed.assetId),
    rest: `${parsed.rest}${url.search}`,
    key: `${identity.user.id}:${row.id}`,
    host: row.bmcIp,
    accounts,
    permissions: identity.permissions,
    actor: identity.user.username,
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

  const denied = missing(target.permissions, bmcPermissions(method, path));
  if (denied) {
    console.warn(`[kvm] ${target.actor} ${method} ${path} 被拒：${denied}`);
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ code: 403, error: denied }));
    return;
  }

  if ((await detectKind(target.host)) === "openbmc") {
    if (path.startsWith("/__pxe/novnc/")) {
      sendNovnc(res, path.slice("/__pxe/novnc/".length));
      return;
    }
    if (path !== "/viewer.html") {
      page(res, 404, "这台 BMC 是 OpenBMC，远程控制台只转 KVM 画面。BMC 自己的网页请直接打开它的地址。");
      return;
    }
    // 先登录一次：账号密码不对时在这里就说清楚，不要等 noVNC 连不上。
    await session(target.key, target.host, target.accounts);
    const ancestors = frameAncestors(req.headers.host);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(ancestors ? { "Content-Security-Policy": ancestors } : {}) });
    res.end(openBmcViewer(target.prefix));
    return;
  }

  let bmc = await session(target.key, target.host, target.accounts);

  if (path === "/__pxe/shim.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(shimScript({ prefix: target.prefix, csrf: bmc.csrf, user: bmc.user, privilege: bmc.privilege, extendedpriv: bmc.extendedpriv, features: await features(bmc), media: target.permissions.includes("media") }));
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
    if (value === undefined || ["connection", "keep-alive", "transfer-encoding", "set-cookie", "content-length", "x-frame-options"].includes(name)) continue;
    out[name] = value;
  }
  const ancestors = frameAncestors(req.headers.host);
  // 逗号隔开就是两条各自生效的策略，BMC 自己的那条不动。
  if (ancestors) out["content-security-policy"] = [out["content-security-policy"] || [], ancestors].flat().join(", ");
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
  const denied = missing(target.permissions, bmcPermissions(req.method || "GET", target.rest.split("?")[0], true));
  if (denied) {
    console.warn(`[kvm] ${target.actor} WebSocket ${target.rest.split("?")[0]} 被拒：${denied}`);
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  const wsPath = target.rest.split("?")[0];
  // 浏览器要的子协议。OpenBMC 的子协议换成了 token，回给浏览器时要换回它要的，不然浏览器会断开。
  const asked = String(req.headers["sec-websocket-protocol"] || "").split(",").map((item) => item.trim()).filter(Boolean);
  detectKind(target.host)
    .then(async (kind) => {
      if (kind === "openbmc" && wsPath !== "/kvm/0") throw new Error("OpenBMC 只转 /kvm/0");
      const isKvm = kind === "ami" && wsPath === "/kvm";
      // 没人经代理在看这台时，先清掉上次留下的 KVM 会话，新开的才能拿到完整权限。OpenBMC 断开 WebSocket 就结束了，不用清。
      if (isKvm && !liveCount(target.host)) await closeStaleQuietly(target, "打开前");
      return { isKvm, bmc: await session(target.key, target.host, target.accounts) };
    })
    .then(({ isKvm, bmc }) => {
      const headers = bmcRequestHeaders(req.headers, bmc, target.prefix, true);
      if (bmc.kind === "openbmc") {
        // bmcweb 的 KVM 要子协议里的 token、会话 cookie，还要 Origin；浏览器的 Origin 已换成 BMC 的，没带的补上。
        headers["Sec-WebSocket-Protocol"] = bmc.csrf;
        headers["X-XSRF-TOKEN"] = bmc.csrf;
        headers.Origin ||= `https://${bmc.host}`;
      }
      const upstream = https.request({
        host: target.host,
        port: bmcPort(),
        method: req.method,
        path: target.rest,
        headers,
        agent: upgradeAgent,
      });
      // BMC 卡住不回握手时别让浏览器一直挂着；握手成功后这个超时就不再管。
      upstream.setTimeout(30_000, () => upstream.destroy(new Error("BMC 30 秒没有回应")));
      upstream.on("upgrade", (response, bmcSocket, bmcHead) => {
        upstream.setTimeout(0);
        const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          const name = response.rawHeaders[i];
          let value = response.rawHeaders[i + 1];
          if (name.toLowerCase() === "sec-websocket-protocol") {
            if (!asked.length) continue;
            if (!asked.includes(value)) value = asked[0];
          }
          lines.push(`${name}: ${value}`);
        }
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
