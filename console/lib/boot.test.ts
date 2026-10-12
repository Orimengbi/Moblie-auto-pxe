import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-boot-test-"));
process.env.PXE_DATA_DIR = temp;

const boot = await import("./boot.ts");
const store = await import("./store.ts");

const profile = { id: "p1", projectId: "nope" } as import("./types.ts").Profile;
const mac = "aa:bb:cc:dd:ee:01";

test("answer files only go to machines that are installing", async () => {
  assert.match(boot.answerDenied(profile, mac, "") || "", /认不出来源地址/);
  assert.match(boot.answerDenied(profile, mac, "10.0.0.5") || "", /不在装机网段/);
  assert.match(boot.answerDenied(profile, mac, "192.168.77.60") || "", /最近没有 PXE 启动过/);
  await store.touchMachine(mac);
  assert.match(boot.answerDenied(profile, mac, "192.168.77.60") || "", /不属于当前启用的批次/);
  // 绑定了这个配置的机器可以取，不管批次。
  const file = path.join(temp, "machines", fs.readdirSync(path.join(temp, "machines"))[0]);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), profileId: "p1" }));
  assert.equal(boot.answerDenied(profile, mac, "192.168.77.60"), null);
  assert.match(boot.answerDenied(profile, mac, "192.168.78.60") || "", /不在装机网段/);
  // 太久以前 PXE 启动的不算。
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), lastSeen: new Date(Date.now() - 25 * 3600_000).toISOString() }));
  assert.match(boot.answerDenied(profile, mac, "192.168.77.60") || "", /最近没有 PXE 启动过/);
});

test("clientIp reads X-Real-IP", () => {
  assert.equal(boot.clientIp(new Request("http://x/", { headers: { "x-real-ip": " 192.168.77.9 " } })), "192.168.77.9");
  assert.equal(boot.clientIp(new Request("http://x/")), "");
});
