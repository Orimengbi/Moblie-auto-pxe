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

/** 测试里的机房都放在同一个数据中心。 */
function testDatacenter(racks: typeof import("./racks.ts")): string {
  return racks.listDatacenters()[0]?.id || racks.createDatacenter({ code: "T1", name: "测试数据中心" }).id;
}

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
  assert.throws(() => assets.updateAsset(first.id, { tagOverride: "CORE-SW-1" }, "tester"), /CORE-SW-1 已经/);

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

test("excel import previews, then creates and updates by serial number", async () => {
  const XLSX = await import("xlsx");
  const { parseAssetTable, assetsToRows, normalizeDate } = await import("./asset-sheet.ts");
  assets.createCustomer({ code: "BETA", name: "Beta 智算" });
  const existing = assets.createAsset({ sn: "imp-old", vendor: "Dell", owner: "张三" }, "alice");

  // 用真的 xlsx 走一遍：日期单元格读出来是序列号，要换回日期。
  const sheet = XLSX.utils.aoa_to_sheet([
    ["说明：下面是资产"],
    ["序列号*", "类型", "状态", "归属客户", "型号", "保修到期", "采购日期", "BMC 密码", "颜色"],
    ["imp-new-1", "交换机", "在用", "beta", "SN4600", new Date(Date.UTC(2028, 0, 31)), "2026/3/5", "pw1", "红"],
    ["IMP-OLD", "", "维修中", "Beta 智算", "R760", "", "", "", ""],
    ["imp-bad", "冰箱", "", "", "", "", "", "", ""],
    ["imp-new-1", "", "", "", "", "", "", "", ""],
    ["imp-nocust", "", "", "Gamma", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["imp-date", "", "", "", "", "2026/13/40", "", "", ""],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "资产");
  const read = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]], { header: 1, raw: true, defval: "" }) as unknown[][];
  const parsed = parseAssetTable(rows);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.ignored, ["颜色"]);
  assert.equal(parsed.records[0].row, 3, "行号按 Excel 里的算");
  assert.equal(parsed.records[0].cells.warrantyEnd, "2028-01-31");
  assert.equal(parsed.records[0].cells.purchaseDate, "2026-03-05");
  assert.equal(normalizeDate("2026年1月2日"), "2026-01-02");

  const before = assets.listAssets().length;
  const preview = assets.importAssets(parsed.records, "alice", { dryRun: true });
  assert.deepEqual([preview.created, preview.updated, preview.unchanged, preview.errors], [1, 1, 0, 4]);
  assert.equal(assets.listAssets().length, before, "预览不写入");
  assert.equal(assets.getAsset(existing.id)?.status, "stock");
  const messages = preview.rows.filter((row) => row.action === "error").map((row) => `${row.row} ${row.message}`);
  assert.match(messages.join("\n"), /5 类型「冰箱」认不出/);
  assert.match(messages.join("\n"), /6 和第 3 行是同一个序列号/);
  assert.match(messages.join("\n"), /7 没有代码或名称是「Gamma」的客户/);
  assert.match(messages.join("\n"), /9 保修到期要写成/);
  assert.match(preview.rows.find((row) => row.sn === "IMP-OLD")!.message, /状态：入库 → 维修中[\s\S]*型号：空 → R760/);

  const done = assets.importAssets(parsed.records, "alice");
  assert.deepEqual([done.created, done.updated, done.errors], [1, 1, 4]);
  const created = assets.findAssetBySn("IMP-NEW-1")!;
  assert.equal(created.type, "switch");
  assert.equal(created.status, "active");
  assert.equal(created.bmcPassword, "pw1");
  assert.equal(created.warrantyEnd, "2028-01-31");
  const updated = assets.getAsset(existing.id)!;
  assert.equal(updated.owner, "张三", "空格子不改");
  assert.equal(updated.model, "R760");
  assert.equal(assets.findAssetBySn("IMP-BAD"), null, "出错的行不入库");

  // 再导一次同样的表：没有变化。导出的表能原样导回来。
  assert.equal(assets.importAssets(parsed.records, "alice").updated, 0);
  const exported = assetsToRows(assets.listAssets(), assets.listCustomers());
  assert.equal(exported[0][0], "编号");
  assert.ok(!exported[0].includes("BMC 密码"), "导出不带密码");
  const round = assets.importAssets(parseAssetTable(exported).records, "alice", { dryRun: true });
  assert.equal(round.errors, 0);
  assert.equal(round.updated + round.created, 0, "导出再导入什么都不变");

  // 写「自有」清空归属。
  const cleared = assets.importAssets([{ row: 2, cells: { sn: "IMP-OLD", customer: "自有" } }], "alice");
  assert.equal(cleared.updated, 1);
  assert.equal(assets.getAsset(existing.id)?.customerId, null);
});

test("racks hold assets in U slots without overlap and moving in marks them racked", async () => {
  const racks = await import("./racks.ts");
  const site = racks.createSite({ datacenterId: testDatacenter(racks), code: "sz1", name: "深圳一号" });
  assert.equal(site.code, "SZ1");
  const made = racks.createRacks({ siteId: site.id, prefix: "A", from: 1, to: 3, pad: 2, heightU: 42 });
  assert.deepEqual(made.created.map((rack) => rack.name), ["A01", "A02", "A03"]);
  assert.deepEqual(racks.createRacks({ siteId: site.id, prefix: "A", from: 3, to: 4, pad: 2 }).skipped, ["A03"], "已经有的跳过");
  assert.deepEqual(racks.listRacks(site.id).map((rack) => rack.name), ["A01", "A02", "A03", "A04"]);
  const a01 = made.created[0];

  const gpu = assets.createAsset({ sn: "rack-gpu", rackId: a01.id, uStart: 10, uHeight: 8 }, "alice");
  assert.equal(gpu.status, "racked", "放进机柜自动上架");
  assert.ok(assets.listEvents(gpu.id).length >= 1);
  assert.throws(() => assets.createAsset({ sn: "rack-clash", rackId: a01.id, uStart: 17, uHeight: 2 }, "alice"), /U10-U17 已经放了 RACK-GPU/);
  assert.throws(() => assets.createAsset({ sn: "rack-top", rackId: a01.id, uStart: 41, uHeight: 4 }, "alice"), /只有 42U/);
  assert.throws(() => assets.createAsset({ sn: "rack-nou", uStart: 3 }, "alice"), /没选机柜/);
  const below = assets.createAsset({ sn: "rack-below", rackId: a01.id, uStart: 8, uHeight: 2, status: "active" }, "alice");
  assert.equal(below.status, "active", "明确给了状态就不自动改");
  const pdu = assets.createAsset({ sn: "rack-pdu", type: "pdu", rackId: a01.id, uStart: 5, uHeight: 0 }, "alice");
  assert.equal(pdu.uStart, null, "侧挂不占 U 位");

  // 挪到别的机柜，时间线里写清楚从哪到哪。
  assets.updateAsset(below.id, { rackId: made.created[1].id, uStart: 1 }, "bob");
  const moved = assets.listEvents(below.id).find((event) => event.kind === "edit")!;
  assert.match(moved.text, /机柜：SZ1 \/ A01 → SZ1 \/ A02/);
  assert.match(moved.text, /起始 U：8 → 1/);

  // 改矮不能挤掉设备；有设备的机柜和有机柜的机房不能删。
  assert.throws(() => racks.updateRack(a01.id, { siteId: site.id, name: "A01", heightU: 16 }), /放到了 U17/);
  assert.equal(racks.updateRack(a01.id, { siteId: site.id, name: "A01", heightU: 20 }).heightU, 20);
  assert.throws(() => racks.deleteRack(a01.id), /还有 2 台/);
  assert.throws(() => racks.deleteSite(site.id), /还有 4 个机柜/);
  assert.throws(() => racks.deleteSite(site.id, true), /还放着 3 台设备/, "连机柜一起删也不能丢掉设备的位置（侧挂的 PDU 也算）");

  // Excel：按机房和机柜号放，导出的位置能原样导回来。
  const { parseAssetTable, assetsToRows } = await import("./asset-sheet.ts");
  const imported = assets.importAssets(
    [
      { row: 2, cells: { sn: "rack-xl", site: "SZ1", rack: "A03", uStart: "U20", uHeight: "2" } },
      { row: 3, cells: { sn: "rack-xl2", rack: "Z99" } },
      { row: 4, cells: { sn: "rack-xl3", site: "SZ1" } },
      { row: 5, cells: { sn: "RACK-GPU", rack: "无" } },
    ],
    "alice",
  );
  assert.deepEqual(imported.rows.map((row) => row.action), ["create", "error", "error", "update"]);
  assert.match(imported.rows[1].message, /没有机柜 Z99/);
  assert.match(imported.rows[2].message, /填了机房就要填机柜/);
  const xl = assets.findAssetBySn("RACK-XL")!;
  assert.deepEqual([xl.rackId, xl.uStart, xl.uHeight], [made.created[2].id, 20, 2]);
  assert.equal(assets.getAsset(gpu.id)?.rackId, null, "写「无」移出机柜");
  assert.equal(assets.getAsset(gpu.id)?.uStart, null);
  const rows = assetsToRows(assets.listAssets(), assets.listCustomers(), racks.listRacks(), racks.listSites());
  const round = assets.importAssets(parseAssetTable(rows).records, "alice", { dryRun: true });
  assert.equal(round.errors, 0, JSON.stringify(round.rows.filter((row) => row.action === "error")));
  assert.equal(round.updated + round.created, 0);
});

test("racks can be created several rows at a time and imported from a sheet", async () => {
  const racks = await import("./racks.ts");
  assert.deepEqual(racks.expandPrefixes("A-C"), ["A", "B", "C"]);
  assert.deepEqual(racks.expandPrefixes("A, E，H"), ["A", "E", "H"]);
  assert.deepEqual(racks.expandPrefixes("R01-R03"), ["R01", "R02", "R03"]);
  assert.throws(() => racks.expandPrefixes("C-A"), /反了/);
  const site = racks.createSite({ datacenterId: testDatacenter(racks), code: "BJ2", name: "北京二号" });
  const made = racks.createRacks({ siteId: site.id, prefix: "A-C", from: 1, to: 4, pad: 2 });
  assert.equal(made.created.length, 12);
  assert.deepEqual(made.created.filter((rack) => rack.rowLabel === "B").map((rack) => rack.name), ["B01", "B02", "B03", "B04"]);
  assert.throws(() => racks.createRacks({ siteId: site.id, prefix: "A-Z", from: 1, to: 50 }), /最多建 1000 个/);

  const rows = [
    ["机房", "机柜号", "列/排", "高度U", "额定功率", "备注"],
    ["BJ2", "A01", "", "48", "", ""],
    ["", "D01", "D", "", "10kW", ""],
    ["北京二号", "D02", "D", "52", "", ""],
    ["XX9", "Z01", "", "", "", ""],
    ["BJ2", "", "", "", "", ""],
    ["BJ2", "D03", "", "abc", "", ""],
  ];
  const preview = racks.importRacks(rows, site.id, { dryRun: true });
  assert.deepEqual(preview.rows.map((row) => row.action), ["update", "create", "create", "error", "error", "error"]);
  assert.match(preview.rows[0].message, /高度：42 → 48/);
  assert.match(preview.rows[3].message, /没有机房「XX9」/);
  assert.match(preview.rows[5].message, /高度需要/);
  assert.equal(racks.listRacks(site.id).length, 12, "预览不写入");
  const done = racks.importRacks(rows, site.id);
  assert.deepEqual([done.created, done.updated, done.errors], [2, 1, 3]);
  assert.equal(racks.listRacks(site.id).find((rack) => rack.name === "D01")?.powerKw, "10kW");
  assert.equal(racks.listRacks(site.id).find((rack) => rack.name === "D02")?.heightU, 52);
});

test("a failed commit does not leave later transactions broken", async () => {
  const { db, transaction } = await import("./db.ts");
  // 外键检查推迟到提交时：插一条指向不存在机柜的资产，COMMIT 才失败。
  assert.throws(
    () =>
      transaction(db(), () => {
        db().exec("PRAGMA defer_foreign_keys = ON");
        db().prepare("UPDATE assets SET rack_id = 'no-such-rack' WHERE sn = 'SRV-001'").run();
      }),
    /FOREIGN KEY/,
  );
  assert.equal(assets.findAssetBySn("SRV-001")?.rackId, null, "失败的那次没写进去");
  // 之后的事务（包括嵌套的）照常能用。
  const made = assets.createAsset({ sn: "after-failed-commit" }, "alice");
  assert.equal(assets.getAsset(made.id)?.sn, "AFTER-FAILED-COMMIT");
});

test("tags stay unique in both directions and dates must exist", async () => {
  const { assertDate } = await import("./validate.ts");
  const { formatTime } = await import("./time.ts");
  // 先有人手动占了下一台按规则会得到的编号（占的这台自己也会用掉一个序号，所以是再下一个）。
  const next = assets.listAssets().reduce((max, item) => Math.max(max, item.seq), 0) + 2;
  const upcoming = assets.renderTag({ seq: next, type: "server", sn: "X", customerId: null, createdAt: new Date().toISOString(), tagOverride: "" }, assets.getTagSettings(), new Map());
  assets.createAsset({ sn: "tag-squatter", tagOverride: upcoming }, "alice");
  // 下一台不会撞上，而是跳过被占的序号。
  const victim = assets.createAsset({ sn: "tag-victim" }, "alice");
  assert.notEqual(victim.tag, upcoming);
  assert.equal(victim.seq, next + 1);
  // 改已有资产的手动编号去撞别人按规则算出的编号，还是不行。
  assert.throws(() => assets.updateAsset(victim.id, { tagOverride: assets.findAssetBySn("SRV-001")!.tag }, "alice"), /已经/);

  assert.equal(assertDate("2028-02-29", "日期"), "2028-02-29");
  assert.throws(() => assertDate("2026-13-45", "保修到期"), /保修到期要写成/);
  assert.throws(() => assertDate("2026-02-30", "保修到期"), /保修到期要写成/);
  assert.throws(() => assets.updateAsset(assets.findAssetBySn("TAG-SQUATTER")!.id, { warrantyEnd: "2026-02-30" }, "alice"), /保修到期/);
  assert.equal(formatTime("2026-10-08T16:30:00Z", "short"), "10/09 00:30", "按北京时间显示");
});

test("xlsx downloads can have Chinese file names", async () => {
  const { xlsxResponse } = await import("./api.ts");
  const response = xlsxResponse([["a"]], "表", "plan-机房二.xlsx");
  assert.match(response.headers.get("content-disposition") || "", /filename="plan-___\.xlsx"; filename\*=UTF-8''plan-%E6%9C%BA%E6%88%BF%E4%BA%8C\.xlsx/);
});

test("rack floor layout auto-places by row and saves positions without overlap", async () => {
  const racks = await import("./racks.ts");
  const { floorPositions } = await import("./floor.ts");
  const site = racks.createSite({ datacenterId: testDatacenter(racks), code: "FL1", name: "俯视图机房" });
  racks.createRacks({ siteId: site.id, prefix: "A,B", from: 1, to: 3, pad: 2 });
  const list = racks.listRacks(site.id);
  const auto = floorPositions(list);
  const at = (name: string) => auto.get(list.find((rack) => rack.name === name)!.id);
  assert.deepEqual([at("A01"), at("A03"), at("B01")], [{ x: 0, y: 0, auto: true }, { x: 2, y: 0, auto: true }, { x: 0, y: 2, auto: true }], "一排一行，排之间空一行");
  const a1 = list.find((rack) => rack.name === "A01")!;
  const b1 = list.find((rack) => rack.name === "B01")!;
  racks.saveLayout(site.id, [{ id: a1.id, x: 5, y: 7, facing: "up" }]);
  const moved = racks.listRacks(site.id);
  assert.deepEqual([moved.find((r) => r.id === a1.id)?.posX, moved.find((r) => r.id === a1.id)?.posY, moved.find((r) => r.id === a1.id)?.facing], [5, 7, "up"]);
  const after = floorPositions(moved);
  assert.ok([...after.values()].filter((p) => p.auto).every((p) => p.y >= 9), "没摆过的放到摆好的下面");
  assert.throws(() => racks.saveLayout(site.id, [{ id: b1.id, x: 5, y: 7 }]), /同一格/);
  racks.saveLayout(site.id, [{ id: a1.id, x: null, y: null }]);
  assert.equal(racks.listRacks(site.id).find((r) => r.id === a1.id)?.posX, null, "回到自动排布");
});

test("pillars push auto-placed racks along, overlap is refused and disabled racks take no devices", async () => {
  const racks = await import("./racks.ts");
  const { floorPositions } = await import("./floor.ts");
  const site = racks.createSite({ datacenterId: testDatacenter(racks), code: "OB1", name: "有柱子的机房" });
  racks.createRacks({ siteId: site.id, prefix: "A", from: 1, to: 4, pad: 2 });
  // A 排第三格是一根柱子：A03、A04 往后挪一格。
  const saved = racks.saveLayout(site.id, [], [{ kind: "pillar", label: "柱 1", x: 2, y: 0, w: 1, h: 1 }]);
  assert.equal(saved.obstacles.length, 1);
  const list = racks.listRacks(site.id);
  const pos = floorPositions(list, saved.obstacles);
  const x = (name: string) => pos.get(list.find((rack) => rack.name === name)!.id)!.x;
  assert.deepEqual(["A01", "A02", "A03", "A04"].map(x), [0, 1, 3, 4]);
  const a1 = list.find((rack) => rack.name === "A01")!;
  assert.throws(() => racks.saveLayout(site.id, [{ id: a1.id, x: 2, y: 0 }]), /柱 1 和 机柜 A01 放在了同一格/);
  assert.throws(() => racks.saveLayout(site.id, [], [{ kind: "ac", label: "", x: 0, y: 5, w: 2, h: 1 }, { kind: "power", label: "", x: 1, y: 5, w: 1, h: 1 }]), /同一格/);
  assert.throws(() => racks.saveLayout(site.id, [], [{ kind: "pillar", label: "", x: 0, y: 0, w: 0, h: 1 }]), /大小不对/);
  // 不给 obstacles 不动障碍物。
  racks.saveLayout(site.id, [{ id: a1.id, x: 0, y: 3 }]);
  assert.equal(racks.listFloorItems(site.id).length, 1);

  // 不可用的机柜：放不了设备；有设备的不能设成不可用。
  const a2 = list.find((rack) => rack.name === "A02")!;
  racks.updateRack(a2.id, { siteId: site.id, name: "A02", heightU: 42, disabled: true, note: "漏水，待修" });
  assert.equal(racks.getRack(a2.id)?.disabled, true);
  assert.throws(() => assets.createAsset({ sn: "into-disabled", rackId: a2.id, uStart: 1 }, "alice"), /不可用，不能放设备/);
  const a3 = list.find((rack) => rack.name === "A03")!;
  assets.createAsset({ sn: "in-a03", rackId: a3.id, uStart: 1 }, "alice");
  assert.throws(() => racks.updateRack(a3.id, { siteId: site.id, name: "A03", heightU: 42, disabled: true }), /先挪走/);
  // 改别的字段不带 disabled 时保持原样。
  assert.equal(racks.updateRack(a2.id, { siteId: site.id, name: "A02", heightU: 48 }).disabled, true);
});

test("data centers hold rooms, rooms move between them and sheets carry the data center", async () => {
  const racks = await import("./racks.ts");
  const { parseAssetTable, assetsToRows } = await import("./asset-sheet.ts");
  const kix = racks.createDatacenter({ code: "kix13", name: "大阪 KIX13", address: "大阪" });
  assert.equal(kix.code, "KIX13");
  assert.throws(() => racks.createDatacenter({ code: "KIX13", name: "重复" }), /已经给了/);
  const nrt = racks.createDatacenter({ code: "NRT1", name: "东京" });
  assert.throws(() => racks.createSite({ code: "S1", name: "没有数据中心" }), /数据中心不存在/);
  const s110 = racks.createSite({ datacenterId: kix.id, code: "S110", name: "S110 机房" });
  const s120 = racks.createSite({ datacenterId: kix.id, code: "S120", name: "S120 机房" });
  const t1 = racks.createSite({ datacenterId: nrt.id, code: "T101", name: "东京一号" });
  assert.throws(() => racks.createSite({ datacenterId: nrt.id, code: "S110", name: "同名" }), /机房代码 S110 已经给了/, "机房代码全局唯一");
  for (const site of [s110, s120, t1]) racks.createRacks({ siteId: site.id, prefix: "A", from: 1, to: 2, pad: 2 });

  assert.throws(() => racks.deleteDatacenter(kix.id), /还有 2 个机房/);
  // 不给 datacenterId 时机房留在原来的数据中心。
  assert.equal(racks.updateSite(s120.id, { code: "S120", name: "改名" }).datacenterId, kix.id);

  // Excel：只写机柜号有歧义，写数据中心还不够时还是歧义，写到机房就唯一。
  const imported = assets.importAssets(
    [
      { row: 2, cells: { sn: "dc-a", rack: "A01" } },
      { row: 3, cells: { sn: "dc-b", datacenter: "KIX13", rack: "A01" } },
      { row: 4, cells: { sn: "dc-c", datacenter: "NRT1", rack: "A01", uStart: "1" } },
      { row: 5, cells: { sn: "dc-d", datacenter: "KIX13", site: "S120", rack: "A02", uStart: "1" } },
      { row: 6, cells: { sn: "dc-e", datacenter: "NRT1", site: "S110", rack: "A01" } },
      { row: 7, cells: { sn: "dc-f", datacenter: "KIX13" } },
    ],
    "alice",
  );
  assert.deepEqual(imported.rows.map((row) => row.action), ["error", "error", "create", "create", "error", "error"], JSON.stringify(imported.rows));
  assert.match(imported.rows[0].message, /对得上好几个（不同机房都有/);
  assert.match(imported.rows[4].message, /数据中心「NRT1」的机房「S110」里没有机柜 A01/);
  assert.match(imported.rows[5].message, /填了数据中心就要填机柜/);

  const rows = assetsToRows(assets.listAssets(), assets.listCustomers(), racks.listRacks(), racks.listSites(), [], racks.listDatacenters());
  const header = rows[0];
  const c = rows.find((row) => row.includes("DC-C"))!;
  assert.deepEqual([c[header.indexOf("数据中心")], c[header.indexOf("机房")], c[header.indexOf("机柜")]], ["NRT1", "T101", "A01"]);
  const round = assets.importAssets(parseAssetTable(rows).records, "alice", { dryRun: true });
  assert.equal(round.errors, 0, JSON.stringify(round.rows.filter((row) => row.action === "error")));

  // 整个机房挪到另一个数据中心，机柜和设备跟着走。
  racks.updateSite(s120.id, { datacenterId: nrt.id, code: "S120", name: "S120 机房" });
  const { assetRows } = await import("./asset-view.ts");
  const d = assetRows(undefined, undefined, { light: true }).find((row) => row.sn === "DC-D")!;
  assert.deepEqual([d.datacenterId, d.place], [nrt.id, "S120 / A02 / U1"]);
  assert.throws(() => racks.updateSite(s120.id, { datacenterId: "nope", code: "S120", name: "x" }), /数据中心不存在/);
});

test("asset template and export carry dropdowns for type, status, datacenter and room", async () => {
  const XLSX = (await import("xlsx")).default;
  const { xlsxWithDropdowns } = await import("./xlsx-dropdown.ts");
  const { assetDropdowns, SHEET_COLUMNS, parseAssetTable } = await import("./asset-sheet.ts");
  const rows = [["编号", ...SHEET_COLUMNS.map((column) => column.header)], ["RS-1", "SN-DROP-1", "服务器", "在用"]];
  const buffer = xlsxWithDropdowns(rows, "资产", assetDropdowns([{ code: "KIX13" }], [{ code: "R1" }, { code: "R2" }]));
  fs.writeFileSync(path.join(temp, "dropdown.xlsx"), buffer);
  // 第一张表照旧能读、能原样导回；选项在第二张隐藏表里。
  const book = XLSX.read(buffer, { type: "buffer" });
  assert.deepEqual(book.SheetNames, ["资产", "选项"]);
  assert.equal(book.Workbook?.Sheets?.[1]?.Hidden, 1);
  const back = XLSX.utils.sheet_to_json(book.Sheets["资产"], { header: 1, defval: "" }) as unknown[][];
  assert.equal(parseAssetTable(back).records[0].cells.sn, "SN-DROP-1");
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets["选项"], { header: 1, defval: "" }).slice(0, 3), [
    ["类型", "状态", "数据中心", "机房"],
    ["服务器", "入库", "KIX13", "R1"],
    ["网络设备", "上架", "", "R2"],
  ]);
  const zip = XLSX.CFB.read(buffer, { type: "buffer" });
  const sheet = Buffer.from(XLSX.CFB.find(zip, "/xl/worksheets/sheet1.xml")!.content as Uint8Array).toString("utf8");
  // 类型是第 C 列（前面有「编号」），状态 D，数据中心 I，机房 J。
  assert.match(sheet, /<\/sheetData><dataValidations count="4">/);
  assert.match(sheet, /sqref="C2:C1000"><formula1>'选项'!\$A\$2:\$A\$5<\/formula1>/);
  assert.match(sheet, /errorStyle="stop"[^>]*sqref="D2:D1000"><formula1>'选项'!\$B\$2:\$B\$9</);
  assert.match(sheet, /errorStyle="warning"[^>]*sqref="I2:I1000"><formula1>'选项'!\$C\$2:\$C\$2</);
  assert.match(sheet, /sqref="J2:J1000"><formula1>'选项'!\$D\$2:\$D\$3</);
  // 没有数据中心、机房时只给类型和状态下拉。
  const bare = XLSX.CFB.read(xlsxWithDropdowns(rows, "资产", assetDropdowns([], [])), { type: "buffer" });
  assert.match(Buffer.from(XLSX.CFB.find(bare, "/xl/worksheets/sheet1.xml")!.content as Uint8Array).toString("utf8"), /<dataValidations count="2">/);
});

test("floor plan: room walls, doors on walls, four facings and swapping an empty rack for a pillar", async () => {
  const racks = await import("./racks.ts");
  const site = racks.createSite({ datacenterId: testDatacenter(racks), code: "FP1", name: "平面图机房" });
  racks.createRacks({ siteId: site.id, prefix: "A", from: 1, to: 4, pad: 2 });
  const list = racks.listRacks(site.id);
  const id = (name: string) => list.find((rack) => rack.name === name)!.id;
  const placed = list.map((rack, index) => ({ id: rack.id, x: index + 1, y: 1, facing: "left" as const }));

  const saved = racks.saveLayout(
    site.id,
    placed,
    [
      { kind: "door", label: "前门", x: 2, y: 0, w: 2, h: 1, side: "bottom" },
      { kind: "switch", label: "总闸", x: 0, y: 1, w: 1, h: 1, side: "left" },
      { kind: "ac", label: "", x: 6, y: 0, w: 1, h: 3 },
    ],
    [],
    { w: 8, h: 4 },
  );
  assert.deepEqual([saved.site.floorW, saved.site.floorH], [8, 4]);
  assert.equal(saved.racks.find((rack) => rack.id === id("A01"))?.facing, "left");
  const door = saved.obstacles.find((item) => item.kind === "door")!;
  assert.deepEqual([door.side, door.x, door.w], ["bottom", 2, 2]);
  // 门在墙上，不占机房里的格子：同一位置可以放机柜。
  assert.equal(racks.floorItemCells(door).length, 0);

  assert.throws(() => racks.saveLayout(site.id, [{ id: id("A01"), x: 8, y: 1 }]), /外墙外面/);
  assert.throws(() => racks.saveLayout(site.id, [], [{ kind: "door", label: "", x: 7, y: 0, w: 2, h: 1, side: "top" }]), /超出了那面墙/);
  assert.throws(
    () => racks.saveLayout(site.id, [], [{ kind: "door", label: "甲", x: 1, y: 0, w: 2, h: 1, side: "top" }, { kind: "door", label: "乙", x: 2, y: 0, w: 1, h: 1, side: "top" }]),
    /甲 和 乙 在墙上重叠了/,
  );
  assert.throws(() => racks.saveLayout(site.id, [], [], [], { w: 8, h: 0 }), /一起填/);
  assert.throws(() => racks.saveLayout(site.id, [{ id: id("A01"), x: 1, y: 1, facing: "sideways" as never }]), /朝向/);
  // 机房改成不设大小：墙上的东西不能留。
  assert.throws(() => racks.saveLayout(site.id, [], undefined, [], { w: 0, h: 0 }), /外墙|墙上|要先设/);

  // 空机柜换成柱子：机柜删掉，柱子放在原位。
  const swapped = racks.saveLayout(site.id, [], [...saved.obstacles, { kind: "pillar", label: "柱", x: 2, y: 1, w: 1, h: 1 }], [id("A02")]);
  assert.equal(swapped.racks.some((rack) => rack.name === "A02"), false);
  assert.ok(swapped.obstacles.some((item) => item.kind === "pillar" && item.x === 2 && item.y === 1));
});

test("floor plan editing helpers: shift a row right, move a group, check walls and overlaps", async () => {
  const { moveKeys, planProblem, shiftRow } = await import("./floor.ts");
  const plan = {
    racks: { a1: { x: 0, y: 0, facing: "" as const }, a2: { x: 1, y: 0, facing: "" as const }, a3: { x: 2, y: 0, facing: "" as const }, b1: { x: 0, y: 2, facing: "" as const } },
    items: [{ id: "door", kind: "door" as const, label: "", x: 1, y: 0, w: 1, h: 1, side: "top" as const }],
    room: { w: 4, h: 4 },
    removed: [] as string[],
  };
  assert.equal(planProblem(plan), "");
  // A 排第二格放柱子：A02、A03 往右挪，B 排不动。
  const shifted = shiftRow(plan, 1, 0);
  assert.deepEqual([shifted.racks.a1.x, shifted.racks.a2.x, shifted.racks.a3.x, shifted.racks.b1.x], [0, 2, 3, 0]);
  assert.equal(planProblem(shifted), "");
  assert.match(planProblem(shiftRow(shifted, 2, 0)), /出了机房的墙/, "挪出墙要报出来");
  // 整体挪：机柜和墙上的门一起往右一格，门只沿墙走。
  const moved = moveKeys(plan, ["r:b1", "i:door"], 1, 1);
  assert.deepEqual([moved.racks.b1, moved.items[0].x, moved.items[0].y], [{ x: 1, y: 3, facing: "" }, 2, 0]);
  assert.match(planProblem(moveKeys(plan, ["r:b1"], 1, -2)), /重叠/);
  // 换掉的机柜不算占格子。
  assert.equal(planProblem({ ...moveKeys(plan, ["r:b1"], 1, -2), removed: ["a2"] }), "");
});

test("a room can be deleted together with its empty racks and floor items", async () => {
  const racks = await import("./racks.ts");
  const site = racks.createSite({ datacenterId: testDatacenter(racks), code: "DEL1", name: "要重建的机房" });
  racks.createRacks({ siteId: site.id, prefix: "A,B", from: 1, to: 20, pad: 2 });
  racks.saveLayout(site.id, [], [{ kind: "pillar", label: "", x: 30, y: 0, w: 1, h: 1 }]);
  assert.throws(() => racks.deleteSite(site.id), /还有 40 个机柜/);
  assert.equal(racks.deleteSite(site.id, true).racks, 40);
  assert.equal(racks.getSite(site.id), null);
  assert.equal(racks.listRacks(site.id).length, 0);
  assert.equal(racks.listFloorItems(site.id).length, 0);
});

test("rack numbers match loosely: g3 finds G03, but G3 and G03 cannot both exist", async () => {
  const racks = await import("./racks.ts");
  assert.deepEqual(["g3", "G03", "G-03", "g 003"].map(racks.rackKey), ["G|3", "G|3", "G|3", "G|3"]);
  assert.notEqual(racks.rackKey("A1-01"), racks.rackKey("A101"));
  const site = racks.createSite({ datacenterId: testDatacenter(racks), code: "LZ1", name: "补零机房" });
  racks.createRacks({ siteId: site.id, prefix: "G", from: 1, to: 5, pad: 2 });
  const finder = racks.cachedRackFinder();
  const found = finder("LZ1", "g3");
  assert.ok(found && found !== "ambiguous");
  const g03 = found;
  assert.equal(g03.name, "G03");
  assert.equal(finder("LZ1", "G9"), null);
  assert.throws(() => racks.createRack({ siteId: site.id, name: "G3", heightU: 42 }), /已经有机柜 G03，和 G3 是同一个机柜号/);
  const again = racks.createRacks({ siteId: site.id, prefix: "G", from: 4, to: 6, pad: 1 });
  assert.deepEqual([again.created.map((rack) => rack.name), again.skipped], [["G6"], ["G4", "G5"]]);
  // 资产导入填 g3 能放进 G03。
  const imported = assets.importAssets([{ row: 2, cells: { sn: "LOOSE-RACK-1", site: "LZ1", rack: "g3", uStart: "10", uHeight: "2" } }], "alice");
  assert.equal(imported.errors, 0, JSON.stringify(imported.rows));
  assert.equal(assets.findAssetBySn("LOOSE-RACK-1")?.rackId, g03.id);
});
