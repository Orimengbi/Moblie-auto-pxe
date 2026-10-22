import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";

process.env.PXE_TRUSTED_PROXY_HOST = "";
const { installClientAddressGuard, isLoopback, plainAddress, settleClientAddress } = await import("./client-address.ts");

test("only nginx may say where a request came from", () => {
  const direct: http.IncomingHttpHeaders = { "x-real-ip": "192.168.77.9", "x-forwarded-for": "10.0.0.1, 10.0.0.2" };
  settleClientAddress(direct, "203.0.113.5", false);
  assert.deepEqual(direct, { "x-real-ip": "203.0.113.5" }, "直连控制台的人填的地址不算");

  const viaNginx: http.IncomingHttpHeaders = { "x-real-ip": "192.168.77.9", "x-forwarded-for": "10.0.0.1" };
  settleClientAddress(viaNginx, "172.19.0.3", true);
  assert.deepEqual(viaNginx, { "x-real-ip": "192.168.77.9" }, "nginx 设的 X-Real-IP 保留，客户端带的 X-Forwarded-For 照样删");

  const bare: http.IncomingHttpHeaders = {};
  settleClientAddress(bare, "172.19.0.3", true);
  assert.equal(bare["x-real-ip"], "172.19.0.3", "nginx 没设就用 nginx 自己的地址");

  assert.equal(plainAddress("::ffff:172.19.0.3"), "172.19.0.3");
  assert.ok(isLoopback("127.0.0.1") && isLoopback("::1"));
  assert.ok(!isLoopback("172.19.0.1"), "开发 compose 里宿主机转进来的请求不是回环");
});

test("the guard rewrites headers before any server sees the request", async () => {
  await installClientAddressGuard();
  const server = http.createServer((req, res) => res.end(JSON.stringify([req.headers["x-real-ip"], req.headers["x-forwarded-for"] ?? null])));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  // 正式环境 nginx 从 127.0.0.1 连过来，没有 boot 这个名字可查（这里也不查），它设的地址照样保留。
  const trusted = await (await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-real-ip": "192.168.77.9", "x-forwarded-for": "1.2.3.4" } })).json();
  assert.deepEqual(trusted, ["192.168.77.9", null]);
  server.close();
});
