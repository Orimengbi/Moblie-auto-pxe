import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-identify-test-"));
process.env.PXE_DATA_DIR = temp;

const { enrichRecords, enrichRow, mergeIdentity, needsBmc, parseFru, placeholderSerial } = await import("./bmc-identify.ts");
const { fillAssetFromBmc, prepareAssetImport } = await import("./asset-import.ts");
const assets = await import("./assets.ts");
const { parseAssetTable } = await import("./asset-sheet.ts");

const found = { sn: "6QM8N72HMA0065", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000", bmcMac: "30:56:0f:df:8b:2c", hostname: "", via: "Redfish" };

test("a row with only BMC address and account gets SN, vendor, model and BMC MAC from the BMC", async () => {
  const calls: string[] = [];
  const identify = async (ip: string, user: string, password: string) => {
    calls.push(`${ip} ${user}`);
    if (password !== "good") throw new Error("BMC 不接受这个账号密码");
    return found;
  };
  const result = await enrichRow({ bmcIp: "43.128.1.40", bmcUser: "root", bmcPassword: "bad", bmcFallbackUser: "admin", bmcFallbackPassword: "good", model: "手填型号" }, identify);
  assert.equal(result.error, "");
  assert.equal(result.cells.sn, found.sn);
  assert.equal(result.cells.vendor, "Giga Computing");
  assert.equal(result.cells.model, "手填型号", "表里填了的不改");
  assert.equal(result.cells.bmcMac, found.bmcMac);
  assert.match(result.note, /从 BMC（Redfish）读到：序列号 6QM8N72HMA0065，厂商 Giga Computing，BMC MAC/);
  assert.deepEqual(calls, ["43.128.1.40 root", "43.128.1.40 admin"], "主账号被拒再试备用账号");
});

test("BMC failures only block rows that have no SN", async () => {
  const down = async () => {
    throw new Error("BMC 没有回应");
  };
  const withSn = await enrichRow({ sn: "SN1", bmcIp: "10.0.0.1", bmcUser: "a", bmcPassword: "b" }, down);
  assert.equal(withSn.error, "");
  assert.match(withSn.note, /没读到/);
  const withoutSn = await enrichRow({ bmcIp: "10.0.0.1", bmcUser: "a", bmcPassword: "b" }, down);
  assert.match(withoutSn.error, /没填序列号，BMC 10.0.0.1 又读不到：BMC 没有回应/);
  assert.match((await enrichRow({ bmcIp: "10.0.0.1" }, down)).error, /也没填账号密码/);
  assert.match((await enrichRow({ model: "x" }, down)).error, /没填序列号，也没填 BMC 地址/);
});

test("a filled SN is checked against the BMC: a mismatch is an error and nothing is filled from that BMC", async () => {
  const other = await enrichRow({ sn: "TYPO1", bmcIp: "10.0.0.2", bmcUser: "a", bmcPassword: "good" }, async () => found);
  assert.match(other.error, /序列号对不上：填的是 TYPO1，BMC 10.0.0.2（Redfish）报的是 6QM8N72HMA0065/);
  assert.deepEqual(other.mismatch, { entered: "TYPO1", bmc: found.sn, via: "Redfish" });
  assert.equal(other.cells.vendor, undefined, "多半是别的机器，不补");
  // 大小写、空格不同算一致；格子都填了也要连 BMC 核对。
  const full = { sn: "6qm8n72hma 0065", vendor: "v", model: "m", bmcMac: "aa:bb:cc:dd:ee:ff", bmcIp: "10.0.0.3", bmcUser: "a", bmcPassword: "good" };
  assert.ok(needsBmc(full));
  const same = await enrichRow(full, async () => found);
  assert.equal(same.error, "");
  assert.match(same.note, /序列号和 BMC 一致/);
  const noSn = await enrichRow({ sn: "SN9", bmcIp: "10.0.0.4", bmcUser: "a", bmcPassword: "good" }, async () => ({ ...found, sn: "" }));
  assert.equal(noSn.error, "");
  assert.match(noSn.note, /BMC 没报序列号，没核对/);
});

test("batch import skips rows whose SN does not match the BMC", async () => {
  const prepared = await prepareAssetImport(
    [
      { row: 2, cells: { sn: "TYPO2", bmcIp: "10.0.1.1", bmcUser: "a", bmcPassword: "good" } },
      { row: 3, cells: { bmcIp: "10.0.1.2", bmcUser: "a", bmcPassword: "good" } },
    ],
    [],
    undefined,
    async (ip) => ({ ...found, sn: `SN-${ip.replaceAll(".", "-")}` }),
  );
  assert.deepEqual(prepared.failed.map((item) => item.row), [2]);
  assert.deepEqual(prepared.records.map((item) => item.cells.sn), ["SN-10-0-1-2"]);
});

test("single create reads the SN from the BMC, and asks when the filled SN differs", async () => {
  const identify = async () => found;
  const read = await fillAssetFromBmc({ type: "server", bmcIp: "10.0.2.1", bmcUser: "a", bmcPassword: "good", model: "手填" }, false, identify);
  assert.ok("input" in read);
  assert.equal(read.input.sn, found.sn);
  assert.equal(read.input.vendor, found.vendor);
  assert.equal(read.input.model, "手填");
  const asked = await fillAssetFromBmc({ sn: "TYPO3", bmcIp: "10.0.2.1", bmcUser: "a", bmcPassword: "good" }, false, identify);
  assert.deepEqual(asked, { mismatch: { entered: "TYPO3", bmc: found.sn, via: "Redfish" } });
  // 坚持用填的：不连 BMC，也不补别的。
  const kept = await fillAssetFromBmc({ sn: "TYPO3", bmcIp: "10.0.2.1", bmcUser: "a", bmcPassword: "good" }, true, async () => assert.fail("不该连 BMC"));
  assert.ok("input" in kept);
  assert.equal(kept.input.vendor, undefined);
  await assert.rejects(fillAssetFromBmc({ type: "server" }, false, identify), /没填序列号，也没填 BMC 地址/);
});

test("no account: the SN comes from an existing asset with that BMC address", async () => {
  const asset = assets.createAsset({ sn: "BYIP001", type: "server", bmcIp: "10.9.9.9" }, "test");
  const result = await enrichRow({ bmcIp: "10.9.9.9", status: "在用" }, async () => found);
  assert.equal(result.cells.sn, "BYIP001");
  assert.match(result.note, new RegExp(`对上已有资产 ${asset.tag}`));
});

test("the sheet header may have BMC address instead of SN, and rows are enriched in parallel", async () => {
  const parsed = parseAssetTable([
    ["BMC 地址", "BMC 账号", "BMC 密码"],
    ["10.1.0.1", "admin", "good"],
    ["10.1.0.2", "admin", "good"],
  ]);
  assert.equal(parsed.error, undefined);
  const map = await enrichRecords(parsed.records, async (ip) => ({ ...found, sn: `SN-${ip}` }));
  assert.deepEqual([...map.values()].map((item) => item.cells.sn), ["SN-10.1.0.1", "SN-10.1.0.2"]);
});

test("ipmitool fru output is read field by field", () => {
  const fields = parseFru(" Chassis Serial        : NA\n Board Mfg             : GIGA-BYTE\n Product Manufacturer  : Giga Computing\n Product Name          : G894-ZD3\n Product Serial        : 6QM8N72HMA0065\n");
  assert.equal(fields["Product Serial"], "6QM8N72HMA0065");
  assert.equal(fields["Board Mfg"], "GIGA-BYTE");
});

test("factory placeholder serials are not taken, and FRU product data wins over unflashed SMBIOS", () => {
  for (const sn of ["01234567890123", "0123456789", "123456789", "FFFFFFFF", "000000000001".replace("1", "0")]) assert.ok(placeholderSerial(sn), sn);
  for (const sn of ["6QL8N72HMA0063", "QH8N2500035", "2617G89401R10U1E0C", "12345"]) assert.equal(placeholderSerial(sn), false, sn);
  // 技嘉 G894 有一批 SMBIOS 没刷：Redfish 报 01234567890123 / MZB3-PE2-000，FRU 产品区才是整机。
  const redfish = { sn: "", vendor: "Giga Computing", model: "MZB3-PE2-000", bmcMac: "30:56:0f:dd:3b:3e", hostname: "", via: "Redfish" };
  const ipmi = { sn: "6QL8N72HMA0063", vendor: "Giga Computing", model: "G894-ZD3-AAX7-000", bmcMac: "", hostname: "", via: "IPMI" };
  assert.deepEqual(mergeIdentity(redfish, ipmi), { ...ipmi, bmcMac: redfish.bmcMac, via: "Redfish + IPMI" });
  const fields = parseFru(" Board Product         : MZB3-PE2-000\n Board Serial          : QH8N2500035\n Product Name          : G894-ZD3-AAX7-000\n Product Serial        : 6QL8N72HMA0063\n");
  assert.equal(fields["Product Name"], "G894-ZD3-AAX7-000");
});
