import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-kvm-test-"));
process.env.PXE_DATA_DIR = temp;

const auth = await import("./auth.ts");
const store = await import("./store.ts");
const { parseServerTable } = await import("./server-sheet.ts");
const kvm = await import("./kvm-proxy.ts");

test("root paths in BMC pages and headers are moved under the server's prefix", () => {
  const prefix = "/__bmc/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
  assert.deepEqual(kvm.parseBmcPath(`${prefix}/api/kvm/token`), {
    projectId: "11111111-1111-4111-8111-111111111111",
    serverId: "22222222-2222-4222-8222-222222222222",
    rest: "/api/kvm/token",
  });
  assert.equal(kvm.parseBmcPath("/api/projects"), null);
  const html = kvm.rewriteHtml('<html><head><link href="/viewer.min.css"><script data-main="/app/main" src="/viewer.min.js"></script><img src="images/a.png"><a href="//x">', prefix);
  assert.ok(html.startsWith(`<html><head><script src="${prefix}/__pxe/shim.js"></script>`));
  assert.match(html, new RegExp(`href="${prefix}/viewer.min.css"`));
  assert.match(html, new RegExp(`data-main="${prefix}/app/main" src="${prefix}/viewer.min.js"`));
  assert.match(html, /src="images\/a.png"/);
  assert.match(html, /href="\/\/x"/);
  assert.equal(kvm.rewriteCss("a{background:url(/img/x.png)} b{background:url('/y.png')}", prefix), `a{background:url(${prefix}/img/x.png)} b{background:url('${prefix}/y.png')}`);

  const headers = kvm.bmcRequestHeaders(
    { host: "206.54.31.194:45678", origin: "http://206.54.31.194:45678", referer: `http://206.54.31.194:45678${prefix}/viewer.html`, cookie: "pxe_session=secret", "x-csrftoken": "browser", connection: "keep-alive" },
    { host: "192.168.77.151", sid: "s1", csrf: "c1" },
    prefix,
  );
  assert.equal(headers.Host, "192.168.77.151");
  assert.equal(headers.Origin, "https://192.168.77.151");
  assert.equal(headers.Referer, "https://192.168.77.151/viewer.html");
  assert.equal(headers.Cookie, "QSESSIONID=s1", "控制台的 cookie 不交给 BMC");
  assert.equal(headers["X-CSRFTOKEN"], "c1");
  assert.equal(headers.Connection, undefined);
  assert.deepEqual(Object.keys(kvm.canonicalHeaders({ upgrade: "websocket", "sec-websocket-key": "k" })), ["Upgrade", "Sec-WebSocket-Key"]);

  const shim = kvm.shimScript({ prefix, csrf: "c1", user: "ops", privilege: 4, extendedpriv: 3, features: ["CD_SERVER_APP", "KVM_SESSION_RECONNECT"] });
  assert.match(shim, /"CD_SERVER_APP_FLAG":true,"HOST_CURSOR_ENABLED_FLAG":false,"KVM_SESS_RECON_FLG":true/);
  assert.match(shim, /window\.kvm_access = 1;/);
  assert.doesNotThrow(() => new Function(shim), "shim 是合法的 JavaScript");
});

test("the proxy logs in to the BMC itself and relays pages and the KVM socket", { skip: spawnSync("openssl", ["version"]).error ? "no openssl" : false }, async () => {
  spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=bmc", "-keyout", path.join(temp, "k.pem"), "-out", path.join(temp, "c.pem")]);
  const seen: { method: string; path: string; headers: Record<string, unknown>; body: string }[] = [];
  let validSession = "s1";
  let logins = 0;
  // 上次关掉面板后留下的 KVM 会话，加一个别人直接登录 BMC 开的会话。
  let kvmSessions = [
    { id: 14, client_ip: "127.0.0.1", session_type: 5 },
    { id: 20, client_ip: "10.0.0.5", session_type: 5 },
  ];
  const bmc = https.createServer({ key: fs.readFileSync(path.join(temp, "k.pem")), cert: fs.readFileSync(path.join(temp, "c.pem")) }, (req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method || "", path: req.url || "", headers: req.headers, body });
      if (req.url === "/api/session" && req.method === "POST") {
        const form = new URLSearchParams(body);
        if (form.get("username") === "ops" && form.get("password") === "new-pass") {
          logins += 1;
          validSession = `s${logins}`;
          res.writeHead(200, { "set-cookie": `QSESSIONID=${validSession}; path=/; secure;HttpOnly`, "content-type": "application/json" });
          res.end(`{"ok":0,"CSRFToken":"csrf${logins}","privilege":4,"extendedpriv":259,"remote_addr":"127.0.0.1"}`);
        } else {
          res.writeHead(401);
          res.end('{"code":15000}');
        }
        return;
      }
      if (req.headers.cookie !== `QSESSIONID=${validSession}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end('{"error":"Invalid Authentication"}');
        return;
      }
      if (req.url === "/api/settings/services") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('[{"id":1,"service_name":"web"},{"id":2,"service_name":"kvm"}]');
      } else if (req.url === "/api/settings/service-sessions?service_id=2") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(kvmSessions));
      } else if (req.method === "DELETE" && req.url?.startsWith("/api/settings/service-sessions/")) {
        const id = Number(req.url.split("/").pop());
        kvmSessions = kvmSessions.filter((item) => item.id !== id);
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":0}');
      } else if (req.url === "/viewer.html") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip", "set-cookie": "refresh=1; secure" });
        res.end(zlib.gzipSync('<html><head><script data-main="/app/main" src="/viewer.min.js"></script></head><body>KVM</body></html>'));
      } else if (req.url === "/api/configuration/project") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('[{"feature":"CD_SERVER_APP"}]');
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "https://127.0.0.1/viewer.html" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/javascript" });
        res.end("asset");
      }
    });
  });
  bmc.on("upgrade", (req, socket) => {
    seen.push({ method: "UPGRADE", path: req.url || "", headers: req.headers, body: "" });
    // 和 AMI 一样只认首字母大写的握手头。
    const names = req.rawHeaders.filter((_, i) => i % 2 === 0);
    if (!names.includes("Upgrade") || !names.includes("Sec-WebSocket-Key") || req.headers.cookie !== `QSESSIONID=${validSession}`) {
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    kvmSessions.push({ id: 30, client_ip: "127.0.0.1", session_type: 5 });
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (chunk) => socket.write(Buffer.concat([Buffer.from("echo:"), chunk])));
  });
  await new Promise<void>((resolve) => bmc.listen(0, "127.0.0.1", resolve));
  process.env.PXE_KVM_BMC_PORT = String((bmc.address() as net.AddressInfo).port);

  const project = await store.createProject({ name: "KVM" });
  await store.importServerSheet(
    project.id,
    parseServerTable([
      ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统"],
      ["sn-kvm", "aa:bb:cc:dd:ee:a1", "admin", "old-pass", "ops", "new-pass", "Ubuntu"],
    ]).records,
  );
  await store.reconcileServers(project.id, {
    leasesText: "9999999999 aa:bb:cc:dd:ee:a1 127.0.0.1 * *\n",
    exec: async () => ({ code: 0, stdout: "Chassis Power is on\n", stderr: "" }),
  });
  const row = store.listServers().find((item) => item.projectId === project.id)!;
  assert.equal(row.bmcIp, "127.0.0.1");
  const saved = JSON.parse(fs.readFileSync(path.join(temp, "servers", `${row.id}.json`), "utf8"));
  fs.writeFileSync(path.join(temp, "servers", `${row.id}.json`), JSON.stringify({ ...saved, passwordChanged: true }));

  const user = auth.createUser({ username: "kvm-user", password: "kvm-user-pass" });
  const cookie = `${auth.SESSION_COOKIE}=${auth.createSession({ user, method: "password", credentialId: "" })}`;
  const proxy = kvm.createKvmProxy();
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as net.AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const prefix = kvm.bmcPrefix(project.id, row.id);

  assert.equal((await fetch(`${base}${prefix}/viewer.html`)).status, 401, "没登录控制台不给看");
  const start = await fetch(`${base}${prefix}/`, { headers: { cookie }, redirect: "manual" });
  assert.equal(start.headers.get("location"), `${prefix}/viewer.html`);

  const viewer = await fetch(`${base}${prefix}/viewer.html`, { headers: { cookie } });
  assert.equal(viewer.status, 200);
  assert.equal(viewer.headers.get("set-cookie"), null, "BMC 的 cookie 不发给浏览器");
  assert.equal(viewer.headers.get("content-encoding"), null);
  const html = await viewer.text();
  assert.match(html, new RegExp(`<head><script src="${prefix}/__pxe/shim.js"></script><script data-main="${prefix}/app/main" src="${prefix}/viewer.min.js">`));
  const login = seen.find((item) => item.path === "/api/session")!;
  assert.equal(new URLSearchParams(login.body).get("username"), "ops", "改过账号的先用目标账号");
  const forwarded = seen.find((item) => item.path === "/viewer.html")!;
  assert.equal(forwarded.headers.cookie, "QSESSIONID=s1");
  assert.equal(forwarded.headers["x-csrftoken"], "csrf1");

  const shim = await (await fetch(`${base}${prefix}/__pxe/shim.js`, { headers: { cookie } })).text();
  assert.match(shim, /"CD_SERVER_APP_FLAG":true/);
  assert.match(shim, /var csrf = "csrf1"/);

  const redirect = await fetch(`${base}${prefix}/redirect`, { headers: { cookie }, redirect: "manual" });
  assert.equal(redirect.headers.get("location"), `${prefix}/viewer.html`);

  assert.equal((await fetch(`${base}${prefix}/api/session`, { method: "DELETE", headers: { cookie } })).status, 200);
  assert.ok(!seen.some((item) => item.method === "DELETE"), "页面退出不注销小主机保存的 BMC 会话");
  const crossSite = await fetch(`${base}${prefix}/api/settings/x`, { method: "PUT", headers: { cookie, origin: "http://evil.example" }, body: "{}" });
  assert.equal(crossSite.status, 403);

  validSession = "expired";
  const again = await fetch(`${base}${prefix}/app/main.js`, { headers: { cookie } });
  assert.equal(await again.text(), "asset", "BMC 会话过期后自动重新登录");
  assert.equal(logins, 2);

  const socket = net.connect(port, "127.0.0.1");
  const reply = await new Promise<string>((resolve) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\r\n\r\n") && !data.includes("echo:") && data.startsWith("HTTP/1.1 101")) socket.write("frame");
      if (data.includes("echo:frame") || !data.startsWith("HTTP/1.1 101")) resolve(data);
    });
    socket.write(`GET ${prefix}/kvm HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nupgrade: websocket\r\nconnection: Upgrade\r\ncookie: ${cookie}\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-protocol: binary\r\n\r\n`);
  });
  assert.match(reply, /^HTTP\/1\.1 101/);
  assert.equal(seen.find((item) => item.method === "UPGRADE")?.path, "/kvm");
  assert.deepEqual(kvmSessions.map((item) => item.id), [20, 30], "打开前清掉了上次留下的会话，别人的不动");
  socket.destroy();
  await new Promise((resolve) => setTimeout(resolve, 3500));
  assert.deepEqual(kvmSessions.map((item) => item.id), [20], "关掉面板后结束自己的 KVM 会话");

  auth.updateUser(user.id, { disabled: true });
  assert.equal((await fetch(`${base}${prefix}/viewer.html`, { headers: { cookie } })).status, 401, "停用用户后远程控制台也断开");

  proxy.close();
  bmc.close();
  proxy.closeAllConnections();
  bmc.closeAllConnections();
});
