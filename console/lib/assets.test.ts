import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-assets-test-"));
process.env.PXE_DATA_DIR = temp;

const assets = await import("./assets.ts");
const store = await import("./store.ts");
const { parseServerTable } = await import("./server-sheet.ts");

test("asset tags follow the template and change as soon as it is saved", () => {
  const acme = assets.createCustomer({ code: "acme", name: "Acme 云" });
  assert.equal(acme.code, "ACME");
  assert.throws(() => assets.createCustomer({ code: "ACME", name: "重复" }), /已经给了/);

  const first = assets.createAsset({ sn: "srv-001", vendor: "Gigabyte", customerId: acme.id }, "tester");
  const second = assets.createAsset({ sn: "sw-001", type: "switch" }, "tester");
  assert.equal(first.tag, "RS-SRV-00001");
  assert.equal(second.tag, "RS-NET-00002");
  assert.throws(() => assets.createAsset({ sn: "SRV-001" }, "tester"), /已经入库/);

  assets.saveTagSettings({ template: "{customer}-{type}{seq:3}", noCustomer: "OWN", typeCodes: { server: "S", switch: "N", pdu: "P", other: "O" } });
  assert.equal(assets.getAsset(first.id)?.tag, "ACME-S001");
  assert.equal(assets.getAsset(second.id)?.tag, "OWN-N002");

  // 改客户代码，编号跟着变。
  assets.updateCustomer(acme.id, { code: "AC", name: "Acme 云" });
  assert.equal(assets.getAsset(first.id)?.tag, "AC-S001");

  assert.throws(() => assets.saveTagSettings({ template: "{customer}-{type}" }), /\{seq\} 或 \{sn\}/);
  assert.throws(() => assets.saveTagSettings({ template: "{seq}-{owner}" }), /认不出/);
  assert.throws(() => assets.saveTagSettings({ template: "A {seq}" }), /空格/);

  // 手动编号优先，不能和别人的撞。
  assets.updateAsset(second.id, { tagOverride: "CORE-SW-1" }, "tester");
  assert.equal(assets.getAsset(second.id)?.tag, "CORE-SW-1");
  assert.throws(() => assets.updateAsset(first.id, { tagOverride: "CORE-SW-1" }, "tester"), /已经是/);

  assert.throws(() => assets.deleteCustomer(acme.id), /还有 1 台/);
  assets.saveTagSettings(assets.DEFAULT_TAG_SETTINGS);
});

test("asset edits are validated and land in the timeline without passwords", () => {
  const asset = assets.createAsset({ sn: "edit-1", bmcUser: "admin", bmcPassword: "s3cret" }, "alice");
  assert.equal(assets.publicAsset(asset).hasBmcPassword, true);
  assert.equal("bmcPassword" in assets.publicAsset(asset), false);

  assert.throws(() => assets.updateAsset(asset.id, { warrantyEnd: "2026/10/08" }, "alice"), /日期/);
  assert.throws(() => assets.updateAsset(asset.id, { warrantyStart: "2027-01-01", warrantyEnd: "2026-01-01" }, "alice"), /早于/);
  assert.throws(() => assets.updateAsset(asset.id, { status: "lost" as never }, "alice"), /状态不对/);
  assert.throws(() => assets.updateAsset(asset.id, { bmcIp: "300.1.1.1" }, "alice"), /BMC 地址/);

  // 密码留空不改。
  const updated = assets.updateAsset(asset.id, { status: "active", bmcPassword: "", bmcIp: "10.0.0.9", purchaseOrder: "PO-1", warrantyEnd: "2026-12-31" }, "alice");
  assert.equal(updated.bmcPassword, "s3cret");
  assert.equal(updated.status, "active");
  assets.updateAsset(asset.id, { bmcPassword: "n3w" }, "bob");

  const events = assets.listEvents(asset.id);
  assert.equal(events.at(-1)?.text, "入库，状态「入库」");
  assert.ok(events.some((event) => event.kind === "status" && event.text === "状态：入库 → 在用" && event.actor === "alice"));
  const edits = events.filter((event) => event.kind === "edit").map((event) => event.text).join("\n");
  assert.match(edits, /BMC 地址：空 → 10\.0\.0\.9/);
  assert.match(edits, /BMC 密码已更新/);
  assert.doesNotMatch(edits, /s3cret|n3w/);

  assert.equal(assets.warrantyState(updated, "2026-10-08"), "expiring");
  assert.equal(assets.warrantyState(updated, "2026-06-01"), "valid");
  assert.equal(assets.warrantyState(updated, "2027-01-01"), "expired");
  assert.equal(assets.warrantyState({ warrantyEnd: "" }), "none");
});

test("install batch rows create and update assets, and the asset outlives the batch", async () => {
  const project = await store.createProject({ name: "批次一" });
  await store.importServerSheet(
    project.id,
    parseServerTable([
      ["序列号", "IPMI MAC", "原用户", "原密码", "目标用户", "目标密码", "安装系统", "系统地址", "系统掩码"],
      ["batch-1", "aa:bb:cc:dd:ee:01", "admin", "old-pass", "ops", "new-pass", "Ubuntu", "10.9.0.11", "24"],
      ["EDIT-1", "aa:bb:cc:dd:ee:02", "admin", "old-pass", "ops", "new-pass", "Ubuntu", "", ""],
    ]).records,
  );
  const rows = store.listServers().filter((row) => row.projectId === project.id);
  const fresh = rows.find((row) => row.sn === "BATCH-1")!;
  const existing = rows.find((row) => row.sn === "EDIT-1")!;
  assert.equal(fresh.assetId, fresh.id, "新机器的资产沿用这一行的 id");
  assert.equal(existing.assetId, assets.findAssetBySn("EDIT-1")?.id, "已经入库的按序列号挂上去");

  const asset = assets.getAsset(fresh.assetId)!;
  assert.equal(asset.status, "installing");
  assert.equal(asset.bmcMac, "aa:bb:cc:dd:ee:01");
  assert.equal(asset.bmcUser, "admin", "还没改账号时用原账号");
  assert.equal(asset.osAddress, "10.9.0.11");
  assert.equal(assets.getAsset(existing.assetId)?.bmcIp, "10.0.0.9", "表里没有的不覆盖资产上的值");

  // 按租约找到 BMC，地址同步到资产。
  await store.reconcileServers(project.id, {
    leasesText: "9999999999 aa:bb:cc:dd:ee:01 192.168.77.31 * *\n",
    exec: async () => ({ code: 0, stdout: "Chassis Power is on\n", stderr: "" }),
  });
  const synced = assets.getAsset(fresh.assetId)!;
  assert.equal(synced.bmcIp, "192.168.77.31");

  // 手改资产上的地址后，批次里那一行没变就不会盖回来。
  assets.updateAsset(fresh.assetId, { osAddress: "10.9.0.99" }, "alice");
  await store.reconcileServers(project.id, {
    leasesText: "9999999999 aa:bb:cc:dd:ee:01 192.168.77.31 * *\n",
    exec: async () => ({ code: 0, stdout: "Chassis Power is on\n", stderr: "" }),
  });
  assert.equal(assets.getAsset(fresh.assetId)?.osAddress, "10.9.0.99");

  // 装好了：状态进「待交付」，时间线里有装机记录。
  await store.markServerInstalled("BATCH-1");
  const done = assets.getAsset(fresh.assetId)!;
  assert.equal(done.status, "pending");
  assert.ok(assets.listEvents(fresh.assetId).some((event) => event.kind === "install" && /待交付/.test(event.text)));

  await store.deleteProject(project.id);
  assert.ok(assets.getAsset(fresh.assetId), "删装机批次不删资产");
});

test("audit entries can be searched and paged", () => {
  for (let i = 0; i < 5; i++) assets.audit({ actor: i % 2 ? "bob" : "alice", ip: "10.0.0.1", action: `动作${i}`, targetId: "t1", detail: i === 3 ? "100%_done" : "" });
  assert.equal(assets.listAudit({ actor: "bob" }).length, 2);
  assert.deepEqual(assets.listAudit({ q: "100%_" }).map((entry) => entry.action), ["动作3"], "% 和 _ 按字面搜");
  const page = assets.listAudit({ limit: 2 });
  assert.equal(page.length, 2);
  assert.ok(assets.listAudit({ before: page[1].id }).every((entry) => entry.id < page[1].id));
});
