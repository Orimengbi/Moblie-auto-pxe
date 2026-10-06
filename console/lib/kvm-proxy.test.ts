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

test("cookies and form fields are rewritten before reaching the BMC", () => {
  assert.equal(kvm.bmcCookieHeader("pxe_session=a; QSESSIONID=b; pxe_kvm=c; __Host-garc=d"), "QSESSIONID=b; __Host-garc=d");
  assert.equal(kvm.substituteLogin("username=x&password=y&certlogin=0", { user: "ops", password: "p&w=1" }), "username=ops&password=p%26w%3D1&certlogin=0");
  const headers = kvm.bmcRequestHeaders(
    { host: "192.168.68.119", origin: "https://192.168.68.119", referer: "https://192.168.68.119/viewer.html?x=1", cookie: "pxe_kvm=t", "x-real-ip": "1.2.3.4", connection: "keep-alive" },
    "192.168.77.151",
  );
  assert.equal(headers.host, "192.168.77.151");
  assert.equal(headers.origin, "https://192.168.77.151");
  assert.equal(headers.referer, "https://192.168.77.151/viewer.html?x=1");
  assert.equal(headers.cookie, undefined);
  assert.equal(headers["x-real-ip"], undefined);
  assert.match(kvm.injectAutologin("<html><body>x</body></html>"), /autologin\.js"><\/script><\/body>/);
  assert.match(kvm.autologinScript('a"b'), /var user = "a\\"b";/);
  assert.deepEqual(Object.keys(kvm.canonicalHeaders({ host: "h", upgrade: "websocket", "sec-websocket-key": "k", "x-csrftoken": "t" })), ["Host", "Upgrade", "Sec-WebSocket-Key", "X-Csrftoken"]);
});

test("the proxy logs in with the stored account and relays pages and the KVM socket", { skip: spawnSync("openssl", ["version"]).error ? "no openssl" : false }, async () => {
  spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=bmc", "-keyout", path.join(temp, "k.pem"), "-out", path.join(temp, "c.pem")]);
  const seen: { path: string; headers: Record<string, unknown>; body: string }[] = [];
  const bmc = https.createServer({ key: fs.readFileSync(path.join(temp, "k.pem")), cert: fs.readFileSync(path.join(temp, "c.pem")) }, (req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ path: req.url || "", headers: req.headers, body });
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(zlib.gzipSync("<html><body>BMC</body></html>"));
      } else if (req.url === "/api/session" && req.method === "POST") {
        const form = new URLSearchParams(body);
        if (form.get("username") === "ops" && form.get("password") === "new-pass") {
          res.writeHead(200, { "set-cookie": "QSESSIONID=s1; path=/; secure;HttpOnly", "content-type": "application/json" });
          res.end('{"ok":0,"CSRFToken":"t"}');
        } else {
          res.writeHead(401);
          res.end('{"code":15000}');
        }
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "https://127.0.0.1/login" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("asset");
      }
    });
  });
  bmc.on("upgrade", (req, socket) => {
    seen.push({ path: req.url || "", headers: req.headers, body: "" });
    // 和 AMI 一样只认首字母大写的握手头。
    const names = req.rawHeaders.filter((_, i) => i % 2 === 0);
    if (!names.includes("Upgrade") || !names.includes("Connection") || !names.includes("Sec-WebSocket-Key")) {
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
      return;
    }
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
  const proxy = kvm.createKvmProxy();
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

  assert.equal((await fetch(`${base}/`)).status, 401);
  const ticket = kvm.kvmTicket(project.id, row.id, user);
  const opened = await fetch(`${base}/__pxe/open?t=${encodeURIComponent(ticket)}`, { redirect: "manual", headers: { cookie: "QSESSIONID=old; __Host-garc=old" } });
  assert.equal(opened.status, 302);
  const cookies = opened.headers.getSetCookie();
  assert.ok(cookies.some((item) => item.startsWith("QSESSIONID=;") && item.includes("Max-Age=0")), "旧 BMC 的会话被清掉");
  assert.ok(cookies.some((item) => item.startsWith("__Host-garc=;") && item.includes("Secure")));
  const cookie = cookies.find((item) => item.startsWith(`${kvm.KVM_COOKIE}=`))!.split(";")[0];
  assert.equal((await fetch(`${base}/__pxe/open?t=${encodeURIComponent(ticket)}`, { redirect: "manual" })).status, 403, "票据只能用一次");

  const index = await fetch(`${base}/`, { headers: { cookie } });
  assert.equal(index.headers.get("content-encoding"), null);
  assert.match(await index.text(), /BMC<script src="\/__pxe\/autologin\.js"><\/script><\/body>/);
  assert.match(await (await fetch(`${base}/__pxe/autologin.js`, { headers: { cookie } })).text(), /var user = "ops"/);

  const login = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { cookie: `${cookie}; pxe_session=secret`, "content-type": "application/x-www-form-urlencoded", origin: "https://192.168.68.119" },
    body: "username=whatever&password=pxe-proxy&certlogin=0",
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie") || "", /QSESSIONID=s1/);
  const posted = seen.find((item) => item.path === "/api/session")!;
  assert.equal(new URLSearchParams(posted.body).get("certlogin"), "0");
  assert.equal(posted.headers.cookie, undefined, "控制台的 cookie 不交给 BMC");
  assert.equal(posted.headers.origin, "https://127.0.0.1");

  const redirect = await fetch(`${base}/redirect`, { headers: { cookie }, redirect: "manual" });
  assert.equal(redirect.headers.get("location"), "/login");

  const socket = net.connect((proxy.address() as net.AddressInfo).port, "127.0.0.1");
  const reply = await new Promise<string>((resolve) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\r\n\r\n") && !data.includes("echo:")) socket.write("frame");
      if (data.includes("echo:frame")) resolve(data);
    });
    socket.write(`GET /kvm HTTP/1.1\r\nhost: x\r\nupgrade: websocket\r\nconnection: Upgrade\r\ncookie: ${cookie}; QSESSIONID=s1\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-protocol: binary\r\n\r\n`);
  });
  assert.match(reply, /^HTTP\/1\.1 101/);
  assert.equal(seen.find((item) => item.path === "/kvm")?.headers.cookie, "QSESSIONID=s1");
  socket.destroy();

  auth.updateUser(user.id, { disabled: true });
  assert.equal((await fetch(`${base}/`, { headers: { cookie } })).status, 401, "停用用户后远程控制台也断开");

  proxy.close();
  bmc.close();
  proxy.closeAllConnections();
  bmc.closeAllConnections();
});
