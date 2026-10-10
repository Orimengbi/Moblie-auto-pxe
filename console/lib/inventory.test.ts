import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { changeDetail, checkBaseline, clean, diffComponents, generateBaseline, INVENTORY_SCRIPT, nicCards, parseDmidecode, parseOsInventory, redfishComponents, sizeToGb, summarizeComponents } from "./inventory.ts";
import { crawlRedfish, RedfishAuthError, type RedfishDoc, type RedfishGet } from "./redfish.ts";
import { linkBetween, linkText, parseNvlinks } from "./topology.ts";
import type { HwComponent } from "./types.ts";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-inventory-test-"));
process.env.PXE_DATA_DIR = temp;

const { createProject, ensureServerAssets, getOptics, getBaseline, getTask, inventoryStatus, latestInventory, listInventory, removeAssetFiles, saveBaseline, baselineFromServer, deleteServer } = await import("./store.ts");
const { deleteAsset, getAsset, updateAsset } = await import("./assets.ts");
const { createTask, queryOptics, runTask } = await import("./remote.ts");
const { serverPath } = await import("./paths.ts");

/** 照一台 2 路 EPYC、8 卡 GPU 服务器的真实输出删减，序列号都换掉了。 */
const OS_OUTPUT = `
===PXEINV tools===
missing ipmitool

===PXEINV dmidecode===
# dmidecode 3.3
SMBIOS 3.5.0 present.

Handle 0x0000, DMI type 0, 26 bytes
BIOS Information
\tVendor: GIGABYTE
\tVersion: R05_F04
\tRelease Date: 04/22/2026
\tCharacteristics:
\t\tPCI is supported

Handle 0x0001, DMI type 1, 27 bytes
System Information
\tManufacturer: Giga Computing
\tProduct Name: G894-ZD3-AAX7-000
\tSerial Number: SYS0001
\tUUID: 6f63c000-1464-11f2-8000-30560f479244

Handle 0x0002, DMI type 2, 15 bytes
Base Board Information
\tManufacturer: Giga Computing
\tProduct Name: MZB3-PE2-000
\tVersion: 01000100
\tSerial Number: BOARD0001
\tAsset Tag: 01234567890

Handle 0x0003, DMI type 3, 22 bytes
Chassis Information
\tManufacturer: Giga Computing
\tSerial Number: CHASSIS0001

Handle 0x0013, DMI type 4, 48 bytes
Processor Information
\tSocket Designation: P0
\tType: Central Processor
\tFlags:
\t\tFPU (Floating-point unit on-chip)
\tVersion: AMD EPYC 9555 64-Core Processor
\tMax Speed: 4400 MHz
\tCurrent Speed: 3200 MHz
\tStatus: Populated, Enabled
\tSerial Number: CPU0SN
\tCore Count: 64
\tThread Count: 128

Handle 0x0014, DMI type 4, 48 bytes
Processor Information
\tSocket Designation: P1
\tVersion: AMD EPYC 9555 64-Core Processor
\tStatus: Populated, Enabled
\tSerial Number: CPU1SN
\tCore Count: 64
\tThread Count: 128

Handle 0x0020, DMI type 17, 92 bytes
Memory Device
\tSize: 128 GB
\tLocator: DIMM_P0_A0
\tType: DDR5
\tSpeed: 6400 MT/s
\tManufacturer: Samsung
\tSerial Number: DIMMA0
\tPart Number: M321RAJA0MB2-CCPWC
\tRank: 2
\tConfigured Memory Speed: 6400 MT/s
\tVolatile Size: 128 GB

Handle 0x0021, DMI type 17, 92 bytes
Memory Device
\tSize: No Module Installed
\tLocator: DIMM_P0_B0
\tType: Unknown

Handle 0x0022, DMI type 17, 92 bytes
Memory Device
\tSize: 131072 MB
\tLocator: DIMM_P1_M0
\tType: DDR5
\tSpeed: 6400 MT/s
\tManufacturer: Samsung
\tSerial Number: DIMMM0
\tPart Number: M321RAJA0MB2-CCPWC
\tRank: 2

===PXEINV bmc===

===PXEINV lsblk===
{
   "blockdevices": [
      {"name": "nvme0n1", "type": "disk", "size": 7681501126656, "model": "SOLIDIGM SB5PH27X076T", "serial": "DISK0001", "rev": null, "tran": "nvme", "rota": false, "vendor": null},
      {"name": "sda", "type": "disk", "size": 0, "model": "Virtual HDisk0", "serial": "AAAA", "rev": "1.00", "tran": "usb", "rota": false, "vendor": "AMI"},
      {"name": "loop0", "type": "loop", "size": 1000, "model": null, "serial": null, "rev": null, "tran": null, "rota": false, "vendor": null}
   ]
}

===PXEINV smart===
--- nvme0n1
{"model_name": "SOLIDIGM SB5PH27X076T", "serial_number": "DISK0001", "firmware_version": "G70YG150"}

===PXEINV gpu===
0, NVIDIA B300 SXM6 AC, GPU0SN, GPU-aaaa, 00000000:06:00.0, 275040, 97.10.52.00.17, 580.95.05, 1100.00
1, NVIDIA B300 SXM6 AC, GPU1SN, GPU-bbbb, 00000000:16:00.0, 275040, 97.10.7E.00.03, 580.95.05, 1100.00
2, NVIDIA B300 SXM6 AC, GPU2SN, GPU-cccc, 00000000:66:00.0, 275040, 97.10.7E.00.03, 580.95.05, 1100.00

===PXEINV net===
--- eno1
mac: 30:56:0f:00:00:44
speed: 2500
state: up
pci: 0000:51:00.0
driver: i40e
firmware-version: 9.20 0x8000d877 1.3353.0
--- enp115s0f0np0
mac: 74:25:54:00:00:b6
speed: 400000
state: up
pci: 0000:73:00.0
driver: mlx5_core
firmware-version: 40.48.1132 (NVD0000000072)
--- usb0
mac: 4a:00:00:00:00:01
speed: -1
state: down
pci: 1-1.4:1.0

===PXEINV vpd===
--- 0000:51:00.0
51:00.0 Ethernet controller: Intel Corporation Ethernet Controller X710 for 10GBASE-T (rev 02)
\tCapabilities: [e0] Vital Product Data
\t\tProduct Name: Example VPD
\t\tRead-only fields:
\t\t\t[V0] Vendor specific:
\t\tEnd
--- 0000:73:00.0
73:00.0 Ethernet controller: Mellanox Technologies CX8 Family [ConnectX-8]
\tCapabilities: [54] Vital Product Data
\t\tProduct Name: Nvidia ConnectX8 XDR IB/800GBE
\t\tRead-only fields:
\t\t\t[PN] Part number: MLX000647
\t\t\t[SN] Serial number: NICSN0001
\t\t\t[V0] Vendor specific: PCIeGen6 x48
\t\tEnd

===PXEINV pcitopo===
0000:06:00.0 0x030200 0x10de 0 /sys/devices/pci0000:00/0000:00:01.1/0000:01:00.0/0000:02:02.0/0000:04:00.0/0000:05:00.0/0000:06:00.0
0000:16:00.0 0x030200 0x10de 0 /sys/devices/pci0000:10/0000:10:01.1/0000:11:00.0/0000:12:02.0/0000:14:00.0/0000:15:00.0/0000:16:00.0
0000:66:00.0 0x030200 0x10de 1 /sys/devices/pci0000:60/0000:60:01.1/0000:61:00.0/0000:62:02.0/0000:64:00.0/0000:65:00.0/0000:66:00.0
0000:73:00.0 0x020000 0x15b3 0 /sys/devices/pci0000:00/0000:00:01.1/0000:01:00.0/0000:02:00.0/0000:73:00.0
0000:73:00.1 0x020000 0x15b3 0 /sys/devices/pci0000:00/0000:00:01.1/0000:01:00.0/0000:02:00.0/0000:73:00.1
0000:51:00.0 0x020000 0x8086 0 /sys/devices/pci0000:50/0000:50:03.1/0000:51:00.0
0000:53:00.0 0x030000 0x1a03 0 /sys/devices/pci0000:50/0000:50:03.3/0000:52:00.0/0000:53:00.0

===PXEINV rdma===
mlx5_0 0000:73:00.0
mlx5_1 0000:73:00.1

===PXEINV gputopo===
\t\u001b[4mGPU0\tGPU1\tGPU2\tNIC0\tCPU Affinity\tNUMA Affinity\tGPU NUMA ID\u001b[0m
GPU0\t X \tNV18\tNV18\tPXB\t0-63\t0\t\tN/A
GPU1\tNV18\t X \tNV18\tNODE\t0-63\t0\t\tN/A
GPU2\tNV18\tNV18\t X \tSYS\t64-127\t1\t\tN/A
NIC0\tPXB\tNODE\tSYS\t X \t\t\t

NIC Legend:

  NIC0: mlx5_0

===PXEINV numa===
NUMA node0 CPU(s):                       0-63
NUMA node1 CPU(s):                       64-127

===PXEINV optics===
===PXEOPT mlx mlx5_0 0000:73:00.0 enp115s0f0np0 ===
{ "result" : { "output" : { "Module Info" : { "Identifier" : "OSFP", "Vendor Name" : "ACCELINK", "Vendor Part Number" : "RTXM600-2401", "Vendor Serial Number" : "MODSN0001", "FW Version" : "80.1.0", "Rx Power Current [dBm]" : "0,2,0,0 [-8..6]" } } }, "status" : { "code" : 0 } }
===PXEOPT end===

===PXEINV end===
`;

function find(list: HwComponent[], kind: string, slot: string): HwComponent {
  const item = list.find((c) => c.kind === kind && c.slot === slot);
  assert.ok(item, `${kind} ${slot}`);
  return item;
}

test("cleans BIOS placeholders and converts memory sizes", () => {
  assert.equal(clean("  To Be Filled By O.E.M. "), "");
  assert.equal(clean("N/A"), "");
  assert.equal(clean("01234567890123456789AB"), "");
  assert.equal(clean(" MLX000647   "), "MLX000647");
  assert.equal(sizeToGb("131072 MB"), 128);
  assert.equal(sizeToGb("2 TB"), 2048);
  assert.equal(sizeToGb("No Module Installed"), undefined);
  const blocks = parseDmidecode("Handle 0x0001, DMI type 1, 27 bytes\nSystem Information\n\tSerial Number: X1\n\tFlags:\n\t\tFPU\n");
  assert.deepEqual(blocks, [{ type: 1, title: "System Information", fields: { "Serial Number": "X1", Flags: "" } }]);
});

test("parses the in-system collection output into components", () => {
  const { components, warnings } = parseOsInventory(OS_OUTPUT);
  assert.deepEqual(warnings, ["系统里没有 ipmitool"]);
  const system = find(components, "system", "整机");
  assert.equal(system.model, "G894-ZD3-AAX7-000");
  assert.equal(system.sn, "SYS0001");
  assert.equal(system.attrs.chassisSn, "CHASSIS0001");
  assert.equal(system.attrs.memorySlots, 3);
  assert.equal(find(components, "board", "主板").sn, "BOARD0001");
  assert.equal(find(components, "firmware", "BIOS").firmware, "R05_F04");

  const cpu = find(components, "cpu", "P0");
  assert.equal(cpu.model, "AMD EPYC 9555 64-Core Processor");
  assert.deepEqual(cpu.attrs, { cores: 64, threads: 128, maxMHz: 4400, speedMHz: 3200 });
  assert.equal(components.filter((c) => c.kind === "cpu").length, 2);

  const dimms = components.filter((c) => c.kind === "memory");
  assert.deepEqual(dimms.map((c) => c.slot), ["DIMM_P0_A0", "DIMM_P1_M0"]);
  assert.equal(dimms[0].model, "M321RAJA0MB2-CCPWC");
  assert.deepEqual(dimms[1].attrs, { sizeGB: 128, type: "DDR5", speedMT: 6400, rank: 2 });

  const disks = components.filter((c) => c.kind === "disk");
  assert.equal(disks.length, 1, "BMC 的虚拟盘和 loop 设备不算");
  assert.equal(disks[0].firmware, "G70YG150");
  assert.deepEqual(disks[0].attrs, { capacityGB: 7682, media: "NVMe SSD", transport: "nvme" });

  const gpu = find(components, "gpu", "0000:06:00.0");
  assert.equal(gpu.sn, "GPU0SN");
  assert.equal(gpu.firmware, "97.10.52.00.17");
  assert.equal(gpu.attrs.index, 0);
  assert.equal(gpu.attrs.memoryMiB, 275040);

  const nics = components.filter((c) => c.kind === "nic");
  assert.deepEqual(nics.map((c) => c.slot), ["eno1", "enp115s0f0np0"], "USB 网口不算");
  assert.equal(nics[0].model, "Intel Corporation Ethernet Controller X710 for 10GBASE-T", "VPD 是占位时用 lspci 的名字");
  assert.equal(nics[1].model, "Nvidia ConnectX8 XDR IB/800GBE");
  assert.equal(nics[1].sn, "NICSN0001");
  assert.equal(nics[1].attrs.partNumber, "MLX000647");
  assert.equal(nics[1].attrs.speedMbps, undefined, "协商速率是口上的，不算硬件");

  const optics = components.filter((c) => c.kind === "transceiver");
  assert.deepEqual(optics.map((c) => [c.slot, c.vendor, c.model, c.sn, c.firmware]), [["enp115s0f0np0", "ACCELINK", "RTXM600-2401", "MODSN0001", "80.1.0"]]);

  assert.deepEqual(summarizeComponents(components).slice(2, 4), ["CPU 2 × AMD EPYC 9555 64-Core Processor", "内存 2 × M321RAJA0MB2-CCPWC 128GB，共 256 GB（2/3 槽）"]);
  assert.match(parseOsInventory(OS_OUTPUT.replace(/===PXEINV end===\n/, "")).warnings.join(), /没有跑完/);
});

test("the collection script stays read-only and marks every section", () => {
  for (const section of ["tools", "dmidecode", "bmc", "lsblk", "smart", "gpu", "net", "vpd", "pcitopo", "rdma", "gputopo", "numa", "optics", "end"]) {
    assert.match(INVENTORY_SCRIPT, new RegExp(`sec ${section}\\n`));
  }
  assert.doesNotMatch(INVENTORY_SCRIPT, /\b(rm|dd|mkfs|wipefs|reboot|shutdown)\b/);
});

const REDFISH: Record<string, RedfishDoc> = {
  "/redfish/v1/": { Systems: { "@odata.id": "/redfish/v1/Systems" }, Chassis: { "@odata.id": "/redfish/v1/Chassis" }, Managers: { "@odata.id": "/redfish/v1/Managers" }, UpdateService: { "@odata.id": "/redfish/v1/UpdateService" } },
  "/redfish/v1/Systems": { Members: [{ "@odata.id": "/redfish/v1/Systems/Self" }, { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0" }] },
  "/redfish/v1/Systems/Self": { "@odata.id": "/redfish/v1/Systems/Self", Id: "Self", Manufacturer: "Giga Computing", Model: "G894-ZD3-AAX7-000", SerialNumber: "SYS0001", BiosVersion: "R05_F04", Processors: { "@odata.id": "/redfish/v1/Systems/Self/Processors" }, Memory: { "@odata.id": "/redfish/v1/Systems/Self/Memory" }, Storage: { "@odata.id": "/redfish/v1/Systems/Self/Storage" } },
  "/redfish/v1/Systems/HGX_Baseboard_0": { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0", Id: "HGX_Baseboard_0", Manufacturer: "NVIDIA", Model: "NA", Processors: { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/Processors" }, Memory: { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/Memory" } },
  "/redfish/v1/Systems/Self/Processors": { Members: [{ "@odata.id": "/redfish/v1/Systems/Self/Processors/CPU0" }] },
  "/redfish/v1/Systems/Self/Processors/CPU0": { "@odata.id": "/redfish/v1/Systems/Self/Processors/CPU0", Id: "CPU0", Socket: "P0", ProcessorType: "CPU", Model: "AMD EPYC 9555 64-Core Processor", TotalCores: 64, TotalThreads: 128, MaxSpeedMHz: 4400, SerialNumber: "CPU0SN", Status: { State: "Enabled" } },
  "/redfish/v1/Systems/HGX_Baseboard_0/Processors": { Members: [{ "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/Processors/GPU_0" }, { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/Processors/FPGA_0" }] },
  "/redfish/v1/Systems/HGX_Baseboard_0/Processors/GPU_0": { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/Processors/GPU_0", Id: "GPU_0", ProcessorType: "GPU", Model: "NVIDIA B300 SXM6 AC", Manufacturer: "NVIDIA", SerialNumber: "GPU0SN", PartNumber: "3182-887-A1", FirmwareVersion: "97.10.52.00.17", Status: { State: "Enabled" } },
  "/redfish/v1/Systems/HGX_Baseboard_0/Processors/FPGA_0": { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/Processors/FPGA_0", Id: "FPGA_0", ProcessorType: "FPGA", Model: "NA" },
  "/redfish/v1/Systems/Self/Memory": { Members: [{ "@odata.id": "/redfish/v1/Systems/Self/Memory/DIMM_P0_A0" }, { "@odata.id": "/redfish/v1/Systems/Self/Memory/DIMM_P0_B0" }] },
  "/redfish/v1/Systems/Self/Memory/DIMM_P0_A0": { "@odata.id": "/redfish/v1/Systems/Self/Memory/DIMM_P0_A0", Id: "DIMM_P0_A0", PartNumber: "M321RAJA0MB2-CCPWC   ", Manufacturer: "Samsung", SerialNumber: "DIMMA0", CapacityMiB: 131072, MemoryDeviceType: "DDR5", OperatingSpeedMhz: 6400, RankCount: 2, Status: { State: "Enabled" } },
  "/redfish/v1/Systems/Self/Memory/DIMM_P0_B0": { "@odata.id": "/redfish/v1/Systems/Self/Memory/DIMM_P0_B0", Id: "DIMM_P0_B0", PartNumber: "Unknown", CapacityMiB: 0, Status: { State: "Absent" } },
  "/redfish/v1/Systems/HGX_Baseboard_0/Memory": { Members: [{ "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/Memory/GPU_0_DRAM_0" }] },
  "/redfish/v1/Systems/HGX_Baseboard_0/Memory/GPU_0_DRAM_0": { "@odata.id": "/redfish/v1/Systems/HGX_Baseboard_0/Memory/GPU_0_DRAM_0", Id: "GPU_0_DRAM_0", CapacityMiB: 275040, MemoryDeviceType: "HBM", Status: { State: "Enabled" } },
  "/redfish/v1/Systems/Self/Storage": { Members: [{ "@odata.id": "/redfish/v1/Systems/Self/Storage/StorageUnit_0" }] },
  "/redfish/v1/Systems/Self/Storage/StorageUnit_0": { Drives: [{ "@odata.id": "/redfish/v1/Systems/Self/Storage/StorageUnit_0/Drives/NVMe0" }] },
  "/redfish/v1/Systems/Self/Storage/StorageUnit_0/Drives/NVMe0": { "@odata.id": "/redfish/v1/Systems/Self/Storage/StorageUnit_0/Drives/NVMe0", Id: "NVMe0", Model: "SOLIDIGM SB5PH27X076T", SerialNumber: "DISK0001", CapacityBytes: 7681501126656, MediaType: "SSD", Protocol: "NVMe" },
  // 第一页只有一个机箱，第二页在 nextLink 里。
  "/redfish/v1/Chassis": { Members: [{ "@odata.id": "/redfish/v1/Chassis/HGX_Chassis_0" }], "Members@odata.nextLink": "/redfish/v1/Chassis?$skip=1" },
  "/redfish/v1/Chassis?$skip=1": { Members: [{ "@odata.id": "/redfish/v1/Chassis/Self" }] },
  "/redfish/v1/Chassis/HGX_Chassis_0": { "@odata.id": "/redfish/v1/Chassis/HGX_Chassis_0", PowerSubsystem: { "@odata.id": "/redfish/v1/Chassis/HGX_Chassis_0/PowerSubsystem" } },
  "/redfish/v1/Chassis/HGX_Chassis_0/PowerSubsystem": { PowerSupplies: { "@odata.id": "/redfish/v1/Chassis/HGX_Chassis_0/PowerSubsystem/PowerSupplies" } },
  "/redfish/v1/Chassis/HGX_Chassis_0/PowerSubsystem/PowerSupplies": { Members: [{ "@odata.id": "/redfish/v1/Chassis/HGX_Chassis_0/PowerSubsystem/PowerSupplies/HSC_0" }] },
  "/redfish/v1/Chassis/HGX_Chassis_0/PowerSubsystem/PowerSupplies/HSC_0": { "@odata.id": "/redfish/v1/Chassis/HGX_Chassis_0/PowerSubsystem/PowerSupplies/HSC_0", Name: "HSC_0" },
  "/redfish/v1/Chassis/Self": { "@odata.id": "/redfish/v1/Chassis/Self", NetworkAdapters: { "@odata.id": "/redfish/v1/Chassis/Self/NetworkAdapters" }, Power: { "@odata.id": "/redfish/v1/Chassis/Self/Power" } },
  "/redfish/v1/Chassis/Self/NetworkAdapters": { Members: [{ "@odata.id": "/redfish/v1/Chassis/Self/NetworkAdapters/Onboard_0" }, { "@odata.id": "/redfish/v1/Chassis/Self/NetworkAdapters/ConnectX_NIC_0" }] },
  "/redfish/v1/Chassis/Self/NetworkAdapters/Onboard_0": { "@odata.id": "/redfish/v1/Chassis/Self/NetworkAdapters/Onboard_0", Id: "Onboard_0", Name: "CX8 Family [ConnectX-8]", SerialNumber: "NICSN0001  ", PartNumber: "MLX000647   ", Controllers: [{ FirmwarePackageVersion: "40.48.1132" }] },
  "/redfish/v1/Chassis/Self/NetworkAdapters/ConnectX_NIC_0": { "@odata.id": "/redfish/v1/Chassis/Self/NetworkAdapters/ConnectX_NIC_0", Id: "ConnectX_NIC_0", Name: "ConnectX_NIC_0" },
  "/redfish/v1/Chassis/Self/Power": { PowerSupplies: [{ "@odata.id": "/redfish/v1/Chassis/Self/Power#/PowerSupplies/0", MemberId: "0", Name: "PSU1", Model: "CRPS3200", SerialNumber: "PSU1SN", PowerCapacityWatts: 3200, Status: { State: "Enabled", Health: "OK" } }] },
  "/redfish/v1/Managers": { Members: [{ "@odata.id": "/redfish/v1/Managers/Self" }] },
  "/redfish/v1/Managers/Self": { "@odata.id": "/redfish/v1/Managers/Self", Id: "Self", ManagerType: "BMC", FirmwareVersion: "13.06.26" },
  "/redfish/v1/UpdateService": { FirmwareInventory: { "@odata.id": "/redfish/v1/UpdateService/FirmwareInventory" } },
  "/redfish/v1/UpdateService/FirmwareInventory": { Members: [{ "@odata.id": "/redfish/v1/UpdateService/FirmwareInventory/BIOS" }, { "@odata.id": "/redfish/v1/UpdateService/FirmwareInventory/HGX_FW_GPU_0" }, { "@odata.id": "/redfish/v1/UpdateService/FirmwareInventory/BIOS2" }] },
  "/redfish/v1/UpdateService/FirmwareInventory/BIOS": { "@odata.id": "/redfish/v1/UpdateService/FirmwareInventory/BIOS", Id: "BIOS", Name: "BIOS", Version: "R05_F04" },
  "/redfish/v1/UpdateService/FirmwareInventory/HGX_FW_GPU_0": { "@odata.id": "/redfish/v1/UpdateService/FirmwareInventory/HGX_FW_GPU_0", Id: "HGX_FW_GPU_0", Name: "Software Inventory", Version: "97.10.52.00.17" },
  "/redfish/v1/UpdateService/FirmwareInventory/BIOS2": { "@odata.id": "/redfish/v1/UpdateService/FirmwareInventory/BIOS2", Id: "BIOS2", Name: "BIOS2" },
};

const fakeRedfish: RedfishGet = async (p) => REDFISH[p] ?? null;

test("builds the GPU and NIC topology the way nvidia-smi topo -m names it", () => {
  const { topology } = parseOsInventory(OS_OUTPUT);
  assert.ok(topology);
  assert.deepEqual(
    topology.devices.map((d) => [d.kind, d.pci, d.name, d.numa, d.root]),
    [
      ["gpu", "0000:06:00.0", "GPU0", 0, "pci0000:00"],
      ["gpu", "0000:16:00.0", "GPU1", 0, "pci0000:10"],
      ["gpu", "0000:66:00.0", "GPU2", 1, "pci0000:60"],
      ["nic", "0000:51:00.0", "eno1", 0, "pci0000:50"],
      ["nic", "0000:73:00.0", "enp115s0f0np0", 0, "pci0000:00"],
      ["nic", "0000:73:00.1", "mlx5_1", 0, "pci0000:00"],
    ],
    "ASPEED 显卡不算 GPU；没有网口名的用 RDMA 名",
  );
  const cx8 = topology.devices.find((d) => d.pci === "0000:73:00.0")!;
  assert.deepEqual(cx8.rdma, ["mlx5_0"]);
  assert.equal(cx8.sn, "NICSN0001");
  assert.deepEqual(cx8.bridges, ["0000:00:01.1", "0000:01:00.0", "0000:02:00.0"]);
  assert.deepEqual(topology.numaCpus, { "0": "0-63", "1": "64-127" });
  assert.equal(topology.nvlinks.length, 3);

  const dev = (pci: string) => topology.devices.find((d) => d.pci === pci)!;
  const link = (a: string, b: string) => linkText(linkBetween(topology, dev(a), dev(b)));
  assert.equal(link("0000:06:00.0", "0000:16:00.0"), "NV18");
  assert.equal(link("0000:06:00.0", "0000:73:00.0"), "PXB", "同一个交换芯片下的 GPU 和网卡");
  assert.equal(link("0000:73:00.0", "0000:73:00.1"), "PIX", "同一张卡的两个口");
  assert.equal(link("0000:16:00.0", "0000:73:00.0"), "NODE");
  assert.equal(link("0000:66:00.0", "0000:73:00.0"), "SYS");
  assert.equal(link("0000:06:00.0", "0000:06:00.0"), "X");
  const sibling = { ...dev("0000:51:00.0"), pci: "0000:52:00.0", bridges: ["0000:50:03.3"] };
  assert.equal(linkText(linkBetween(topology, dev("0000:51:00.0"), sibling)), "PHB", "同一个根复合体的不同根端口");

  assert.deepEqual(parseNvlinks("GPU0\t X \n"), []);
  assert.equal(parseOsInventory(OS_OUTPUT.replace(/===PXEINV pcitopo===[\s\S]*?(?====PXEINV rdma)/, "")).topology, undefined);
});

test("walks Redfish across pages and maps it to components", async () => {
  const raw = await crawlRedfish(fakeRedfish);
  assert.deepEqual(raw.errors, []);
  assert.equal(raw.chassis.length, 2, "第二页的机箱也要读到");
  const components = redfishComponents(raw);
  assert.equal(find(components, "system", "整机").sn, "SYS0001");
  assert.equal(find(components, "system", "整机").attrs.memorySlots, 2);
  assert.deepEqual(find(components, "cpu", "P0").attrs, { cores: 64, threads: 128, maxMHz: 4400 });
  assert.deepEqual(components.filter((c) => c.kind === "memory").map((c) => [c.slot, c.model, c.attrs.sizeGB]), [["DIMM_P0_A0", "M321RAJA0MB2-CCPWC", 128]]);
  const gpu = find(components, "gpu", "GPU_0");
  assert.equal(gpu.attrs.memoryMiB, 275040, "HBM 算到 GPU 上，不算内存");
  assert.equal(components.filter((c) => c.kind === "cpu").length, 1, "FPGA 不算 CPU");
  assert.equal(find(components, "disk", "NVMe0").attrs.capacityGB, 7682);
  const nics = components.filter((c) => c.kind === "nic");
  assert.deepEqual(nics.map((c) => [c.slot, c.model, c.sn, c.firmware]), [["Onboard_0", "CX8 Family [ConnectX-8]", "NICSN0001", "40.48.1132"]]);
  const psus = components.filter((c) => c.kind === "psu");
  assert.deepEqual(psus.map((c) => [c.slot, c.model, c.sn, c.attrs.capacityW]), [["PSU1", "CRPS3200", "PSU1SN", 3200]], "HGX 底板上的热插拔控制器不算电源");
  assert.deepEqual(components.filter((c) => c.kind === "firmware").map((c) => [c.slot, c.model, c.firmware]), [
    ["BIOS", "BIOS", "R05_F04"],
    ["HGX_FW_GPU_0", "HGX_FW_GPU_0", "97.10.52.00.17"],
  ]);

  await assert.rejects(crawlRedfish(async () => {
    throw new RedfishAuthError("BMC 拒绝了账号（HTTP 401）");
  }), RedfishAuthError);
  const flaky = await crawlRedfish(async (p) => {
    if (p.endsWith("/Memory")) throw new Error("超时");
    return REDFISH[p] ?? null;
  });
  assert.equal(flaky.memory.length, 0);
  assert.match(flaky.errors.join(), /Memory：超时/);
});

test("diffs two collections of the same machine", () => {
  const before = parseOsInventory(OS_OUTPUT).components;
  assert.deepEqual(diffComponents(before, before), []);

  const after = structuredClone(before);
  // 换了一条内存，GPU 刷了固件，拔了一块网卡，盘符从 nvme0n1 变成 nvme1n1。
  find(after, "memory", "DIMM_P1_M0").sn = "NEWDIMM";
  find(after, "gpu", "0000:06:00.0").firmware = "97.10.7E.00.03";
  after.splice(after.findIndex((c) => c.slot === "eno1"), 1);
  find(after, "disk", "nvme0n1").slot = "nvme1n1";
  after.push({ kind: "disk", slot: "nvme0n1", model: "SOLIDIGM SB5PH27X076T", vendor: "", sn: "DISK0002", firmware: "G70YG150", attrs: { capacityGB: 7682 } });

  const changes = diffComponents(before, after);
  assert.deepEqual(
    changes.map((c) => [c.type, c.kind, c.slot, c.fields || []]),
    [
      ["replaced", "memory", "DIMM_P1_M0", []],
      ["changed", "gpu", "0000:06:00.0", ["firmware"]],
      ["added", "disk", "nvme0n1", []],
      ["removed", "nic", "eno1", []],
    ],
  );
  assert.equal(changeDetail(changes[0]), "内存 DIMM_P1_M0：M321RAJA0MB2-CCPWC SN DIMMM0 → M321RAJA0MB2-CCPWC SN NEWDIMM");
  assert.equal(changeDetail(changes[1]), "GPU 0000:06:00.0：固件 97.10.52.00.17 → 97.10.7E.00.03");
});

test("lists one NIC per physical card, not one per PCI function", () => {
  const port = (slot: string, pci: string, mac: string, link: string): HwComponent => ({
    kind: "nic",
    slot,
    model: "Nvidia ConnectX7 mezz",
    vendor: "",
    sn: "CX7SN",
    firmware: "28.43.1014",
    attrs: { mac, pci, driver: "mlx5_core", link, partNumber: "V000S4N03X" },
  });
  const ports = [port("ibs11f1", "0000:d9:00.1", "m1", "down"), port("ibs11f0", "0000:d9:00.0", "m0", "up"), port("eno1", "0000:51:00.0", "e0", "up")];
  const cards = nicCards(ports);
  assert.deepEqual(cards.map((c) => c.slot), ["ibs11f0", "eno1"]);
  assert.deepEqual(cards[0].attrs, { mac: "m0", pci: "0000:d9:00.0", driver: "mlx5_core", partNumber: "V000S4N03X", portCount: 2, portNames: "ibs11f0, ibs11f1" });
  assert.equal(cards[1].attrs.link, undefined, "口上的链路状态不算硬件信息");
  assert.deepEqual(nicCards(cards), cards, "合并过的再合并不变");
  assert.deepEqual(diffComponents(ports, cards), [], "旧记录按口列的，和新记录比没有变化");
});

test("generates a baseline from one machine and checks others against it", () => {
  const good = parseOsInventory(OS_OUTPUT).components;
  const rules = generateBaseline(good);
  const gpuRule = rules.find((rule) => rule.kind === "gpu");
  assert.deepEqual(gpuRule, { kind: "gpu", model: "NVIDIA B300 SXM6 AC", count: 3, firmware: "97.10.7E.00.03" }, "过半一致的固件当作要求");
  assert.deepEqual(rules.find((rule) => rule.kind === "memory"), { kind: "memory", model: "M321RAJA0MB2-CCPWC", count: 2, attrs: { sizeGB: "128" } });
  assert.equal(rules.find((rule) => rule.kind === "cpu")?.firmware, undefined);

  assert.deepEqual(
    checkBaseline(rules, good).map((issue) => issue.message),
    ["GPU NVIDIA B300 SXM6 AC：固件应为 97.10.7E.00.03，0000:06:00.0 是 97.10.52.00.17"],
    "基准机自己那张固件不一样的卡也会标出来",
  );

  const bad = structuredClone(good).filter((c) => c.slot !== "DIMM_P1_M0");
  bad.push({ kind: "memory", slot: "DIMM_P1_M0", model: "M321R8GA0BB0-CQKZJ", vendor: "Samsung", sn: "X", firmware: "", attrs: { sizeGB: 64 } });
  find(bad, "gpu", "0000:06:00.0").firmware = "97.10.7E.00.03";
  assert.deepEqual(checkBaseline(rules, bad).map((issue) => issue.message), [
    "内存 M321RAJA0MB2-CCPWC 容量 GB 128：应有 2 个，实有 1 个（少 1 个）",
    "内存 M321R8GA0BB0-CQKZJ 容量 GB 64：基准里没有，实有 1 个",
  ]);
  const onlyGpu = rules.filter((rule) => rule.kind === "gpu");
  assert.deepEqual(checkBaseline(onlyGpu, bad), [], "基准里没有的类别不检查");
  assert.deepEqual(checkBaseline([{ ...gpuRule!, model: "nvidia  b300 sxm6 ac" }], bad), [], "型号不分大小写和空格");
});

test("inventory tasks collect both sources, keep history and feed the baseline", async () => {
  const project = await createProject({ name: "验收", note: "" });
  const serverId = "33333333-3333-4333-8333-333333333333";
  const row = {
    id: serverId,
    projectId: project.id,
    sn: "SYS0001",
    ipmiMac: "aa:bb:cc:00:00:01",
    originalUser: "admin",
    originalPassword: "old-pass",
    targetUser: "ops",
    targetPassword: "new-pass",
    osName: "",
    customization: "",
    ipmiAddress: "",
    ipmiNetmask: "",
    ipmiGateway: "",
    networkApplied: false,
    bmcIp: "192.168.77.151",
    bootMac: "aa:bb:cc:00:00:02",
    osAddress: "10.0.0.5",
    osNetmask: "255.255.255.0",
    passwordChanged: true,
    canApply: true,
    ipmiLink: "up",
    ipSource: "dhcp",
    power: "on",
    installed: "yes",
    stage: "installing",
    detail: "",
    createdAt: "",
    updatedAt: "",
  };
  fs.mkdirSync(path.dirname(serverPath(serverId)), { recursive: true });
  fs.writeFileSync(serverPath(serverId), JSON.stringify(row));
  // 老数据没有资产：启动时按服务器行补建，资产沿用行的 id，账号取 BMC 现在认的那个。
  assert.equal(ensureServerAssets(), 1);
  assert.equal(getAsset(serverId)?.bmcUser, "ops");
  assert.equal(getAsset(serverId)?.osAddress, "10.0.0.5");
  assert.equal(ensureServerAssets(), 0);
  const context = { nics: [], machines: [], leases: [], locals: ["10.0.0.1"] };

  assert.throws(() => createTask({ kind: "inventory", sources: [], projectId: project.id, assetIds: [serverId] }, context), /至少选一种/);
  const task = createTask({ kind: "inventory", projectId: project.id, assetIds: [serverId], timeoutSec: 60 }, context);
  assert.equal(task.name, "采集硬件配置");
  assert.deepEqual(task.inventorySources, ["os", "bmc"]);
  assert.equal(task.targets[0].host, "10.0.0.5");

  const sshCalls: { args: string[]; limit?: number }[] = [];
  let output = OS_OUTPUT;
  const exec = async (_command: string, args: string[], stdin: string | null, _deadline: number, limit?: number) => {
    sshCalls.push({ args, limit });
    assert.equal(stdin, INVENTORY_SCRIPT);
    return { code: 0, output, timedOut: false };
  };
  const logins: string[] = [];
  const redfish = (_host: string, user: string) => {
    logins.push(user);
    return user === "ops" ? fakeRedfish : async () => Promise.reject(new RedfishAuthError("401"));
  };
  const done = await runTask(task.id, exec, redfish);
  assert.equal(done.targets[0].status, "ok", done.targets[0].output);
  assert.match(done.targets[0].output, /系统内（10\.0\.0\.5）：\n {2}整机 Giga Computing G894-ZD3-AAX7-000 SN SYS0001/);
  assert.match(done.targets[0].output, /BMC（192\.168\.77\.151）：/);
  assert.match(done.targets[0].output, /第一次采集/);
  assert.ok(sshCalls[0].args.includes("root@10.0.0.5"));
  assert.ok((sshCalls[0].limit || 0) > 1_000_000, "采集输出不能只留结尾");
  assert.deepEqual(logins, ["ops"], "改过账号先用目标账号");
  assert.equal(getTask(task.id)?.targets[0].status, "ok");

  assert.equal(latestInventory(serverId, "os")?.components.length, parseOsInventory(OS_OUTPUT).components.length);
  assert.equal(latestInventory(serverId, "bmc")?.host, "192.168.77.151");
  assert.deepEqual(inventoryStatus(serverId, null).issues, null);

  // 生成基准后第二次采集：换了一块盘。
  const baseline = await baselineFromServer(project.id, serverId, "os");
  assert.equal(baseline.fromSn, "SYS0001");
  assert.equal(inventoryStatus(serverId, baseline).issues, 1, "GPU0 的固件不一致");
  output = OS_OUTPUT.replace(/DISK0001/g, "DISK0009");
  const again = await runTask(createTask({ kind: "inventory", sources: ["os"], projectId: project.id, assetIds: [serverId] }, context).id, exec, redfish);
  assert.match(again.targets[0].output, /和上次采集相比有 1 处变化：\n {2}更换 硬盘 nvme0n1：SOLIDIGM SB5PH27X076T SN DISK0001 → SOLIDIGM SB5PH27X076T SN DISK0009/);
  const history = listInventory(serverId);
  assert.deepEqual(history.map((item) => item.source).sort(), ["bmc", "os", "os"]);
  assert.equal(history[0].changes?.length, 1);

  // 基准改成不检查固件后就符合了。
  const edited = await saveBaseline(project.id, { rules: getBaseline(project.id)!.rules.map(({ firmware: _firmware, ...rule }) => rule) });
  assert.equal(inventoryStatus(serverId, edited).issues, 0);
  await assert.rejects(saveBaseline(project.id, { rules: [{ kind: "gpu", model: "x", count: -1 }] }), /数量/);
  await assert.rejects(saveBaseline(project.id, { rules: [{ kind: "toaster", model: "x", count: 1 }] }), /类别/);

  // SSH 连不上、BMC 也拒绝时算连不上。
  const offline = async () => ({ code: 255, output: "ssh: connect to host 10.0.0.5 port 22: No route to host\n", timedOut: false });
  const failed = await runTask(createTask({ kind: "inventory", projectId: project.id, assetIds: [serverId] }, context).id, offline, () => async () => Promise.reject(new RedfishAuthError("BMC 拒绝了账号（HTTP 401）")));
  assert.equal(failed.targets[0].status, "unreachable");
  assert.match(failed.targets[0].output, /SSH 登录失败[\s\S]*BMC（192\.168\.77\.151）：BMC 拒绝了账号/);
  assert.equal(listInventory(serverId).length, 3, "失败的不存");

  // 只要 BMC：没有系统地址也能采。
  const noHost = { nics: [], machines: [], leases: [], locals: [] };
  updateAsset(serverId, { osAddress: "" }, "测试");
  const bmcOnly = createTask({ kind: "inventory", sources: ["bmc"], projectId: project.id, assetIds: [serverId] }, noHost);
  assert.equal(bmcOnly.targets[0].status, "pending");
  assert.equal(createTask({ kind: "inventory", sources: ["os"], projectId: project.id, assetIds: [serverId] }, noHost).targets[0].status, "unreachable");

  // 手动查收发光：只走 SSH，存最近一次。
  updateAsset(serverId, { osAddress: "10.0.0.5" }, "测试");
  const opticsExec = async (_command: string, args: string[], stdin: string | null) => {
    assert.ok(args.includes("root@10.0.0.5"));
    assert.match(stdin || "", /mlxlink/);
    return { code: 0, output: OS_OUTPUT.slice(OS_OUTPUT.indexOf("===PXEOPT")), timedOut: false };
  };
  const reading = await queryOptics(serverId, opticsExec, context);
  assert.equal(reading.host, "10.0.0.5");
  assert.deepEqual(reading.ports.map((port) => [port.port, port.sn, port.rx.join("/")]), [["enp115s0f0np0", "MODSN0001", "0/2/0/0"]]);
  assert.equal(getOptics(serverId)?.at, reading.at);
  await assert.rejects(queryOptics(serverId, async () => ({ code: 255, output: "", timedOut: false }), context), /SSH 登录 10\.0\.0\.5 失败/);
  updateAsset(serverId, { osAddress: "" }, "测试");
  await assert.rejects(queryOptics(serverId, opticsExec, noHost), /找不到系统地址/);

  await deleteServer(project.id, serverId);
  assert.ok(getOptics(serverId), "从装机批次删掉一台不删资产的收发光读数");
  assert.equal(listInventory(serverId).length, 3, "也不删采集记录");
  deleteAsset(serverId);
  removeAssetFiles(serverId);
  assert.equal(getOptics(serverId), null, "删资产时一起删收发光读数");
  assert.deepEqual(listInventory(serverId), [], "删资产时一起删采集记录");
});

test("headline BIOS/BMC versions come from host firmware only", async () => {
  const { headlineFirmware } = await import("./inventory.ts");
  const fw = (slot: string, firmware: string) => ({ kind: "firmware", slot, model: slot, vendor: "", sn: "", firmware, attrs: {} }) as unknown as HwComponent;
  // Redfish（AMI G894）：双 BMC 镜像，HGX 底板 BMC 不算。
  assert.deepEqual(headlineFirmware([fw("HGX_FW_BMC_0", "B3-2602-05.0"), fw("BIOS", "R05_F04"), fw("BMCImage1", "13.06.27"), fw("BMCImage2", "13.06.27")]), { bios: "R05_F04", bmc: "13.06.27" });
  assert.deepEqual(headlineFirmware([fw("BMCImage1", "13.06.27"), fw("BMCImage2", "13.06.26")]), { bios: "", bmc: "13.06.27 / 13.06.26" });
  // 系统内采集。
  assert.deepEqual(headlineFirmware([fw("BIOS", "R05_F04"), fw("BMC", "13.06")]), { bios: "R05_F04", bmc: "13.06" });
  assert.deepEqual(headlineFirmware([]), { bios: "", bmc: "" });
});
