import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-identify-test-"));
process.env.PXE_DATA_DIR = temp;

const { enrichRecords, enrichRow, parseFru } = await import("./bmc-identify.ts");
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
  // 表里的序列号和 BMC 报的不一样时提醒。
  const other = await enrichRow({ sn: "TYPO1", bmcIp: "10.0.0.2", bmcUser: "a", bmcPassword: "good" }, async () => found);
  assert.match(other.note, /BMC 报的序列号是 6QM8N72HMA0065，和表里的不一样/);
  assert.equal(other.cells.sn, "TYPO1");
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
