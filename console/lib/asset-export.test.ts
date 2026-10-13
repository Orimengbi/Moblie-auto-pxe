import assert from "node:assert/strict";
import test from "node:test";
import { buildExportSheets, firmwareFamilies, firmwareFamily, mergedParts } from "./asset-export.ts";
import { assetsToRows } from "./asset-sheet.ts";
import type { Asset, HwComponent, InventorySnapshot, MonitorState } from "./types.ts";

const part = (kind: HwComponent["kind"], slot: string, model: string, attrs: HwComponent["attrs"] = {}, sn = ""): HwComponent => ({ kind, slot, model, vendor: "", sn, firmware: "", attrs });
const snap = (source: "os" | "bmc", at: string, components: HwComponent[]) => ({ id: at, serverId: "a1", source, at, components, changes: [] }) as unknown as InventorySnapshot;
const asset = (id: string, sn: string) => ({ id, tag: `RS-${sn}`, sn, model: "G894", type: "server", status: "active", uHeight: 1 }) as unknown as Asset;

const os = snap("os", "2026-10-13T01:00:00.000Z", [part("cpu", "CPU0", "Xeon 8480+"), part("cpu", "CPU1", "Xeon 8480+"), part("memory", "A1", "M321", { sizeGB: 64 }), part("memory", "A2", "M321", { sizeGB: 64 }), part("disk", "nvme0", "PM9A3", { capacityGB: 3840 }, "S1")]);
const bmc = snap("bmc", "2026-10-13T02:00:00.000Z", [part("cpu", "CPU0", "Xeon 8480+"), part("psu", "PSU1", "PWS-3K"), part("psu", "PSU2", "PWS-3K")]);

test("each kind of part comes from whichever side saw more of it", () => {
  const merged = mergedParts(os, bmc);
  assert.deepEqual(
    merged.map((item) => [item.part.kind, item.source]),
    [["cpu", "系统内"], ["cpu", "系统内"], ["memory", "系统内"], ["memory", "系统内"], ["disk", "系统内"], ["psu", "BMC"], ["psu", "BMC"]],
  );
});

const one = asset("a1", "SN1");
const two = asset("a2", "SN2");
const deps: Parameters<typeof buildExportSheets>[2] = {
    inventory: (id) => (id === "a1" ? { os, bmc } : { os: null, bmc: null }),
    firmware: (id) =>
      id === "a1"
        ? { readAt: "2026-10-13T03:00:00.000Z", data: [{ id: "HGX_FW_GPU_0", name: "HGX_FW_GPU_0", version: "97.10", updateable: true, keptFrom: "2026-10-12T00:00:00.000Z" }, { id: "BIOS", name: "BIOS", version: "R07", updateable: true }] }
        : { readAt: "2026-10-13T03:00:00.000Z", data: [{ id: "BIOS", name: "BIOS", version: "R05", updateable: true }, { id: "MB_CPLD1", name: "CPLD", version: "1", updateable: false }] },
    monitor: (id) => (id === "a1" ? ({ power: "on", bmcAt: "2026-10-13T03:00:00.000Z", bmcOk: true, bmcError: "", osAt: "", osOk: false, osError: "", health: { at: "", overall: "warning", problems: [{ name: "PSU2", severity: "warning", detail: "掉电", source: "redfish" }], redfishError: "" } } as unknown as MonitorState) : null),
    assetRows: (list) => assetsToRows(list, [], [], [], [], [], ["sn", "model"]),
    time: (iso) => iso.slice(0, 16),
};

test("every sheet is there with all columns when nothing is narrowed", () => {
  const sheets = buildExportSheets([one, two], ["health", "hardware", "parts", "firmware", "firmwareList", "assets"], deps);
  // 页的顺序固定，跟勾的顺序无关。
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["资产信息", "硬件汇总", "硬件明细", "固件版本", "固件明细", "健康和监控"]);
  const [assets, hardware, parts, firmware, firmwareList, health] = sheets.map((sheet) => sheet.rows);
  assert.deepEqual(assets, [["编号", "序列号", "型号"], ["RS-SN1", "SN1", "G894"], ["RS-SN2", "SN2", "G894"]]);

  const header = hardware[0];
  const cell = (row: string[], name: string) => row[header.indexOf(name)];
  assert.equal(cell(hardware[1], "CPU"), "2 × Xeon 8480+");
  assert.equal(cell(hardware[1], "内存"), "2 × M321 64GB，共 128 GB");
  assert.equal(cell(hardware[1], "电源"), "2 × PWS-3K");
  assert.equal(cell(hardware[1], "采集时间"), "2026-10-13T02:00");
  assert.equal(cell(hardware[2], "采集时间"), "没采集过");

  assert.deepEqual(parts.find((row) => row[2] === "硬盘"), ["RS-SN1", "SN1", "硬盘", "nvme0", "PM9A3", "", "S1", "", "容量 GB 3840", "系统内", "2026-10-13T01:00"]);
  assert.equal(parts.length, 1 + 7);

  // 固件：主板的列在前、HGX 在后；没有的项空着；HGX 沿用上次的要注明。
  assert.deepEqual(firmware[0], ["编号", "序列号", "型号", "BIOS", "CPLD", "HGX_FW_GPU_0", "读取时间"]);
  assert.deepEqual(firmware[1], ["RS-SN1", "SN1", "G894", "R07", "", "97.10", "2026-10-13T03:00（HGX 是 2026-10-12T00:00 读的）"]);
  assert.deepEqual(firmware[2].slice(3, 6), ["R05", "1", ""]);
  assert.deepEqual(firmwareList[1], ["RS-SN1", "SN1", "HGX_FW_GPU_0", "HGX_FW_GPU_0", "97.10", "是", "2026-10-12T00:00"]);

  assert.deepEqual(health[1].slice(0, 5), ["RS-SN1", "SN1", "开机", "警告", "PSU2：掉电"]);
  assert.equal(health[2][3], "没查过");
});

test("each sheet keeps only the columns, part kinds and firmware families picked", () => {
  const sheets = buildExportSheets([one, two], ["hardware", "parts", "firmware", "firmwareList", "health"], deps, {
    columns: { hardware: ["memory", "gpu"], parts: ["slot", "sn"], firmware: [], firmwareList: ["version"], health: ["power"] },
    partKinds: ["disk"],
    firmwareFamilies: ["HGX_FW_GPU"],
  });
  const [hardware, parts, firmware, firmwareList, health] = sheets.map((sheet) => sheet.rows);
  assert.deepEqual(hardware[0], ["编号", "序列号", "内存", "GPU"]);
  assert.deepEqual(parts, [["编号", "序列号", "槽位", "部件 SN"], ["RS-SN1", "SN1", "nvme0", "S1"]]);
  // 固件版本页：只留挑的固件类，型号和读取时间没挑就不带。
  assert.deepEqual(firmware, [["编号", "序列号", "HGX_FW_GPU_0"], ["RS-SN1", "SN1", "97.10"], ["RS-SN2", "SN2", ""]]);
  assert.deepEqual(firmwareList, [["编号", "序列号", "版本"], ["RS-SN1", "SN1", "97.10"]]);
  assert.deepEqual(health, [["编号", "序列号", "电源"], ["RS-SN1", "SN1", "开机"], ["RS-SN2", "SN2", ""]]);
});

test("firmware items are grouped by family for picking", () => {
  assert.equal(firmwareFamily("HGX_FW_GPU_7"), "HGX_FW_GPU");
  assert.equal(firmwareFamily("BMCImage2"), "BMCImage");
  assert.equal(firmwareFamily("BIOS"), "BIOS");
  const item = (id: string) => ({ id, name: id, version: "1", updateable: true });
  assert.deepEqual(firmwareFamilies([{ data: [item("HGX_FW_GPU_0"), item("HGX_FW_GPU_1"), item("BIOS")] }, null, { data: [item("HGX_FW_GPU_1"), item("MB_CPLD1")] }]), [
    { key: "BIOS", count: 1, hgx: false },
    { key: "MB_CPLD", count: 1, hgx: false },
    { key: "HGX_FW_GPU", count: 2, hgx: true },
  ]);
});
