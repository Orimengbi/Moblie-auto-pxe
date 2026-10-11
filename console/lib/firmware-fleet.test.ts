import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PXE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-firmware-fleet-test-"));

const { firmwareFleet, summarizeFirmware } = await import("./firmware-fleet.ts");
const assets = await import("./assets.ts");
const bmc = await import("./bmc-redfish.ts");

const item = (id: string, version: string) => ({ id, name: id, version, updateable: true });
const machine = (id: string, readAt = "2026-10-11T00:00:00Z") => ({ id, tag: id.toUpperCase(), sn: id, hostname: "", bmcIp: "", readAt });

test("versions are grouped per component, majority first, and machines that differ are listed", () => {
  const machines = [machine("a"), machine("b"), machine("c"), machine("d", "")];
  const inventories = new Map([
    ["a", [item("HGX_FW_GPU_0", "1.0"), item("BIOS", "R05")]],
    ["b", [item("HGX_FW_GPU_0", "1.0"), item("BIOS", "R05")]],
    ["c", [item("HGX_FW_GPU_0", "0.9")]],
  ]);
  const model = summarizeFirmware("G894", machines, inventories);
  assert.deepEqual(
    model.components.map((component) => [component.id, component.hgx, component.versions.map((v) => [v.version, v.machines]), component.missing]),
    [
      ["HGX_FW_GPU_0", true, [["1.0", [0, 1]], ["0.9", [2]]], []],
      ["BIOS", false, [["R05", [0, 1]]], [2]],
    ],
    "HGX 在前；没读过的 d 不算缺",
  );
  assert.deepEqual(model.outliers, [{ machine: 2, items: [{ id: "HGX_FW_GPU_0", version: "0.9", common: "1.0" }, { id: "BIOS", version: "（没有）", common: "R05" }] }]);
});

test("the fleet view reads saved snapshots of servers only, grouped by model", () => {
  const one = assets.createAsset({ sn: "fw-1", model: "G894" }, "t");
  const two = assets.createAsset({ sn: "fw-2", model: "G894" }, "t");
  assets.createAsset({ sn: "fw-sw", type: "switch", model: "SN5600" }, "t");
  bmc.saveSnapshot(one.id, "firmware", [item("HGX_FW_BMC_0", "B3-2602-05.0")]);
  const fleet = firmwareFleet();
  assert.deepEqual(fleet.map((model) => [model.model, model.machines.length]), [["G894", 2]]);
  assert.deepEqual(fleet[0].machines.map((m) => [m.sn, Boolean(m.readAt)]), [["FW-1", true], ["FW-2", false]]);
  assert.equal(fleet[0].components[0].versions[0].version, "B3-2602-05.0");
  void two;
});
