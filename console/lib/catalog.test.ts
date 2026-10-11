import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-catalog-test-"));
process.env.PXE_DATA_DIR = temp;

const assets = await import("./assets.ts");
const catalog = await import("./catalog.ts");
const store = await import("./store.ts");
const { specText } = await import("./catalog-schema.ts");

test("catalog entries are unique per category, aliases included", () => {
  const entry = catalog.saveCatalogEntry(null, { category: "disk", vendor: "Solidigm", model: "SB5PH27X076T", aliases: "SOLIDIGM SB5PH27X076T", attrs: { capacityGB: "7680", formFactor: "U.2", bogus: "x" } });
  assert.deepEqual(entry.attrs, { capacityGB: 7680, formFactor: "U.2" }, "数字字段存数字，不认识的属性丢掉");
  assert.equal(catalog.findCatalog("disk", "solidigm sb5ph27x076t")?.id, entry.id);
  assert.throws(() => catalog.saveCatalogEntry(null, { category: "disk", model: "SOLIDIGM  SB5PH27X076T" }), /已经在字典里/);
  assert.equal(catalog.saveCatalogEntry(null, { category: "memory", model: "SB5PH27X076T" }).category, "memory", "不同分类可以同名");
  assert.throws(() => catalog.saveCatalogEntry(null, { category: "disk", model: "X", attrs: { capacityGB: "大" } }), /要填数字/);
  catalog.deleteCatalogEntry(entry.id);
});

test("autofill creates models from inventory and only fills blanks", async () => {
  const asset = assets.createAsset({ sn: "cat-1", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000" }, "t");
  const mem = { kind: "memory" as const, slot: "A0", model: "M321RAJA0MB2-CCPWF", vendor: "Samsung", sn: "m1", firmware: "", attrs: { sizeGB: 128, type: "DDR5", speedMT: 6400, rank: 2 } };
  const optic = { kind: "transceiver" as const, slot: "eth0", model: "OSFP-800G-DR8", vendor: "OEM", sn: "o1", firmware: "", attrs: { type: "OSFP", compliance: "400GBASE-DR4", wavelengthNm: 1311, length: "500m" } };
  const nic = { kind: "nic" as const, slot: "eth2", model: "Intel Corporation Ethernet Controller X710 for 10GBASE-T", vendor: "", sn: "", firmware: "", attrs: { portCount: 2 } };
  await store.saveInventory({ serverId: asset.id, projectId: "", sn: asset.sn, source: "os", at: new Date().toISOString(), host: "", components: [mem, optic, nic], warnings: [], ports: [] });
  // BMC 报的网卡名字不一样：一个去掉了厂商前缀，一个只能靠料号对上。
  const bmcNic = { ...nic, model: "Ethernet Controller X710 for 10GBASE-T" };
  const cx7 = { kind: "nic" as const, slot: "eth0", model: "NVIDIA ConnectX-7 Adapter Card, 200GbE", vendor: "", sn: "", firmware: "", attrs: { partNumber: "MCX755106AS-HEAT" } };
  const bmcCx7 = { ...cx7, model: "MT2910 Family [ConnectX-7]" };
  await store.saveInventory({ serverId: asset.id, projectId: "", sn: asset.sn, source: "bmc", at: new Date().toISOString(), host: "", components: [bmcNic, cx7, bmcCx7], warnings: [], ports: [] });
  const manual = catalog.saveCatalogEntry(null, { category: "memory", vendor: "", model: "M321RAJA0MB2-CCPWF", attrs: { capacityGB: 64 } });

  const preview = catalog.autofillCatalog(true);
  assert.equal(catalog.listCatalog().length, 2, "预览不写");
  assert.deepEqual(preview.updated, ["内存 M321RAJA0MB2-CCPWF"]);

  const done = catalog.autofillCatalog();
  assert.deepEqual(done.created.sort(), ["光模块 OSFP-800G-DR8", "服务器 G894-ZD3-AAX7-000", "网卡 Intel Corporation Ethernet Controller X710 for 10GBASE-T", "网卡 NVIDIA ConnectX-7 Adapter Card, 200GbE"]);
  assert.deepEqual(catalog.findCatalog("nic", "MT2910 Family [ConnectX-7]")?.model, "NVIDIA ConnectX-7 Adapter Card, 200GbE", "料号相同记成别名");
  assert.deepEqual(catalog.findCatalog("nic", "Ethernet Controller X710 for 10GBASE-T")?.aliases, ["Ethernet Controller X710 for 10GBASE-T"]);
  const memory = catalog.findCatalog("memory", "m321raja0mb2-ccpwf")!;
  assert.equal(memory.id, manual.id);
  assert.equal(memory.vendor, "Samsung");
  assert.equal(memory.attrs.capacityGB, 64, "人填的不覆盖");
  assert.equal(specText(memory), "DDR5 · 64 GB · 6400 MT/s · RDIMM · 2 R · 是");
  assert.equal(specText(catalog.findCatalog("transceiver", "OSFP-800G-DR8")), "OSFP · 800G · 400GBASE-DR4 · 1311 nm · 500m · 单模");
  const x710 = catalog.findCatalog("nic", nic.model)!;
  assert.equal(x710.vendor, "Intel");
  assert.equal(specText(x710), "10G · 2 · RJ45 · Ethernet");
  assert.deepEqual(catalog.autofillCatalog(), { created: [], updated: [] }, "再跑一次没有变化");
});

test("server height in the catalog flows to assets of that model", async () => {
  const racks = await import("./racks.ts");
  const dc = racks.createDatacenter({ code: "HDC", name: "高度测试" });
  const site = racks.createSite({ datacenterId: dc.id, code: "HT1", name: "高度机房" });
  const [r1] = racks.createRacks({ siteId: site.id, prefix: "H", from: 1, to: 1, pad: 2, heightU: 42 }).created;
  const loose = assets.createAsset({ sn: "h-loose", model: "HX-8U" }, "t");
  const low = assets.createAsset({ sn: "h-low", model: "hx-8u", rackId: r1.id, uStart: 1 }, "t");
  const blocker = assets.createAsset({ sn: "h-blocker", model: "OTHER", rackId: r1.id, uStart: 20 }, "t");
  const high = assets.createAsset({ sn: "h-high", model: "HX-8U-ALIAS", rackId: r1.id, uStart: 15 }, "t");
  assert.equal(loose.uHeight, 1, "字典里还没有，默认 1U");

  const entry = catalog.saveCatalogEntry(null, { category: "server", model: "HX-8U", aliases: "HX-8U-ALIAS", attrs: { heightU: 8 } });
  assert.ok(catalog.heightChanged(null, entry));
  const sync = catalog.syncAssetHeights(entry, "admin")!;
  assert.equal(sync.updated, 2);
  assert.deepEqual(sync.failed.map((item) => item.sn), ["H-HIGH"], "U15 起 8U 会压到 U20 的设备，不改");
  assert.match(sync.failed[0].error, /U20 已经放了 H-BLOCKER/);
  assert.deepEqual([assets.getAsset(loose.id)?.uHeight, assets.getAsset(low.id)?.uHeight, assets.getAsset(high.id)?.uHeight, assets.getAsset(blocker.id)?.uHeight], [8, 8, 1, 1]);
  assert.ok(assets.listEvents(low.id).some((event) => /占用 U：1 → 8/.test(event.text)), "资产履历里记一笔");

  const renamed = catalog.saveCatalogEntry(entry.id, { note: "只改备注" });
  assert.equal(catalog.heightChanged(entry, renamed), false, "只改备注不动资产");
  assert.throws(() => catalog.saveCatalogEntry(entry.id, { attrs: { heightU: "2.5" } }), /0 到 60 的整数/);

  assert.equal(assets.createAsset({ sn: "h-new", model: "HX-8U" }, "t").uHeight, 8, "新入库没填占用 U 按字典");
  assert.equal(assets.createAsset({ sn: "h-new-2", model: "HX-8U", uHeight: 4 }, "t").uHeight, 4, "填了的按填的");
  const other = assets.createAsset({ sn: "h-switch", model: "OTHER" }, "t");
  assert.equal(assets.updateAsset(other.id, { model: "HX-8U" }, "t").uHeight, 8, "改成这个型号也按字典");
  assert.equal(assets.updateAsset(other.id, { uHeight: 6 }, "t").uHeight, 6, "之后单台手改可以");
  assert.equal(assets.updateAsset(other.id, { owner: "x" }, "t").uHeight, 6, "改别的字段不回到字典值");
  assert.equal(assets.createAsset({ sn: "h-pdu", type: "pdu", model: "HX-8U" }, "t").uHeight, 1, "类型不同不套用");
});
