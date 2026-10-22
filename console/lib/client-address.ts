import dns from "node:dns";
import http from "node:http";

/**
 * 请求的来源地址。控制台 43123 是浏览器直连的，前面没有 nginx；装机口和远程控制台经 80 端口的 nginx（boot 容器）转过来，
 * nginx 用 X-Real-IP 带上真实地址。以前不管谁连过来都信这两个头，直连 43123 的人可以随便填：
 * 绕过按地址限制的登录失败次数、伪造审计里的地址、冒充装机网段的机器拿应答文件。
 *
 * 现在在 http 服务器收到请求时就改好请求头：只有从 nginx 容器来的才保留它设的 X-Real-IP，别的一律换成 socket 的来源地址；
 * X-Forwarded-For 都删掉（nginx 不覆盖它，客户端带什么就转什么）。后面读 X-Real-IP 的地方拿到的就都是真的。
 */

/** nginx 所在容器的主机名（compose 里的服务名）。 */
function proxyHost(): string {
  return process.env.PXE_TRUSTED_PROXY_HOST ?? "boot";
}

let trusted = new Set<string>();
let lookingUp: Promise<void> | null = null;

function refresh(): Promise<void> {
  const host = proxyHost();
  if (!host) return Promise.resolve();
  lookingUp ||= dns.promises
    .lookup(host, { all: true })
    .then((list) => {
      trusted = new Set(list.map((item) => item.address));
    })
    .catch(() => {})
    .finally(() => {
      lookingUp = null;
    });
  return lookingUp;
}

/**
 * 正式环境（release/compose.yml）都是 host 网络：nginx 从 127.0.0.1 转给只听 127.0.0.1 的控制台，没有 boot 这个名字可查。
 * 回环地址只有本机进程连得上，当 nginx 信。开发用的 compose 里宿主机转进容器的请求来自网桥网关，不是回环。
 */
export function isLoopback(address: string): boolean {
  return address === "::1" || /^127\./.test(address);
}

export function plainAddress(address: string | undefined): string {
  return String(address || "").replace(/^::ffff:/, "");
}

/** 按 socket 来源改写 X-Real-IP，删掉 X-Forwarded-For。fromProxy：这个请求是不是 nginx 转过来的。 */
export function settleClientAddress(headers: http.IncomingHttpHeaders, remote: string, fromProxy: boolean): void {
  const forwarded = headers["x-real-ip"];
  const real = fromProxy && typeof forwarded === "string" && forwarded.trim() ? forwarded.trim() : remote;
  delete headers["x-forwarded-for"];
  if (real) headers["x-real-ip"] = real;
  else delete headers["x-real-ip"];
}

let installed = false;

/** 在本进程所有 http 服务器（Next 和远程控制台代理）上生效。启动时调一次。 */
export function installClientAddressGuard(): Promise<void> {
  if (!installed) {
    installed = true;
    const emit = http.Server.prototype.emit;
    http.Server.prototype.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]) {
      if (event === "request" || event === "upgrade") {
        const req = args[0] as http.IncomingMessage;
        const remote = plainAddress(req.socket?.remoteAddress);
        const fromProxy = trusted.has(remote) || isLoopback(remote);
        // nginx 容器重建后地址会变：私有地址又不在名单里，就重新查一次，下一个请求就认得了。
        if (!fromProxy && remote && /^(10|172|192)\./.test(remote)) void refresh();
        settleClientAddress(req.headers, remote, fromProxy);
      }
      return emit.apply(this, [event, ...args] as Parameters<typeof emit>);
    } as typeof http.Server.prototype.emit;
    setInterval(() => void refresh(), 60_000).unref();
  }
  return refresh();
}
