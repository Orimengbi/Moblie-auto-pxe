import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-bmc-tls-test-"));
process.env.PXE_DATA_DIR = temp;

const tls = await import("./bmc-tls.ts");

function makeCert(name: string): { key: Buffer; cert: Buffer } {
  const key = path.join(temp, `${name}.key`);
  const cert = path.join(temp, `${name}.pem`);
  spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", `/CN=${name}`, "-keyout", key, "-out", cert]);
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

test("pins are remembered, mismatches recorded and trusted on request", () => {
  const a = { fingerprint256: "AA:01" } as never;
  const b = { fingerprint256: "BB:02" } as never;
  assert.equal(tls.checkBmcCert("10.0.0.1:443", a), null);
  assert.equal(tls.checkBmcCert("10.0.0.1:443", a), null);
  const error = tls.checkBmcCert("10.0.0.1:443", b);
  assert.ok(error instanceof tls.BmcCertChanged);
  assert.equal(tls.getBmcCert("10.0.0.1:443")?.seenFingerprint, "BB:02");
  assert.equal(tls.trustSeenBmcCert("10.0.0.1:443"), true);
  assert.equal(tls.checkBmcCert("10.0.0.1:443", b), null);
  assert.equal(tls.checkBmcCert("10.0.0.1:443", a) instanceof tls.BmcCertChanged, true);
  tls.forgetBmcCert("10.0.0.1:443");
  assert.equal(tls.checkBmcCert("10.0.0.1:443", a), null);
  assert.equal(tls.trustSeenBmcCert("10.0.0.1:443"), false, "没有被拒的就不用确认");
  assert.ok(tls.checkBmcCert("10.0.0.2:443", {} as never), "没有证书不连");
});

test("the agent refuses a changed certificate before sending anything", { skip: spawnSync("openssl", ["version"]).error ? "no openssl" : false }, async () => {
  const first = makeCert("bmc-a");
  const second = makeCert("bmc-b");
  let received = 0;
  const server = https.createServer(first, (req, res) => {
    received++;
    res.end(String(req.headers.authorization || ""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  const agent = new tls.BmcAgent({ keepAlive: false });
  const get = () =>
    new Promise<string>((resolve, reject) => {
      const request = https.request({ host: "127.0.0.1", port, path: "/", agent, headers: { Authorization: "Basic c2VjcmV0" } }, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve(body));
      });
      request.on("error", reject);
      request.end();
    });
  try {
    assert.equal(await get(), "Basic c2VjcmV0", "第一次连上就记下");
    assert.equal(await get(), "Basic c2VjcmV0");
    server.setSecureContext(second);
    await assert.rejects(get(), (error: Error) => error instanceof tls.BmcCertChanged);
    assert.equal(received, 2, "换了证书的那次一个请求都没收到");
    assert.equal(tls.trustSeenBmcCert(tls.endpointOf("127.0.0.1", port)), true);
    assert.equal(await get(), "Basic c2VjcmV0");
  } finally {
    agent.destroy();
    server.close();
  }
});
