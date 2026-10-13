import assert from "node:assert/strict";
import test from "node:test";
import { INVENTORY_SCRIPT, parseOsInventory, splitSections } from "./inventory.ts";
import { portSummary, redfishPorts } from "./ports.ts";
import type { RedfishRaw } from "./redfish.ts";
import type { HwComponent, HwPort } from "./types.ts";

/** 一台机器的接口：两个 PCIe 槽一个插着网卡、一个空着，一个 M.2 槽装着 NVMe，背板 4 个盘位装了 1 块，板载 SATA 2 个口，一个 U.2 热插拔盘位。 */
const OUTPUT = `
===PXEINV lsblk===
{"blockdevices": [
  {"name": "nvme0n1", "type": "disk", "size": 960197124096, "model": "SAMSUNG MZ1L2960", "serial": "M2SN", "tran": "nvme", "rota": false},
  {"name": "nvme1n1", "type": "disk", "size": 7681501126656, "model": "SOLIDIGM SB5PH27X076T", "serial": "U2SN", "tran": "nvme", "rota": false},
  {"name": "sda", "type": "disk", "size": 4000787030016, "model": "ST4000NM", "serial": "SASSN", "tran": "sas", "rota": true},
  {"name": "sdb", "type": "disk", "size": 480103981056, "model": "INTEL SSDSC2KB48", "serial": "SATASN", "tran": "sata", "rota": false},
  {"name": "sdc", "type": "disk", "size": 960197124096, "model": "MR9560 VD", "serial": "", "tran": "", "rota": false}
]}

===PXEINV net===
--- ens1f0np0
mac: 74:25:54:00:00:01
speed: 100000
state: up
pci: 0000:41:00.0
--- ens1f1np1
mac: 74:25:54:00:00:02
speed: -1
state: down
pci: 0000:41:00.1

===PXEINV slots===
Handle 0x0021, DMI type 9, 17 bytes
System Slot Information
\tDesignation: PCIE1
\tType: x16 PCI Express 5 x16
\tCurrent Usage: Available
\tLength: Long
\tID: 1
\tBus Address: 0000:40:01.1

Handle 0x0022, DMI type 9, 17 bytes
System Slot Information
\tDesignation: PCIE2
\tType: x16 PCI Express 5 x16
\tCurrent Usage: Available
\tLength: Long
\tID: 2
\tBus Address: 0000:50:01.1

Handle 0x0023, DMI type 9, 17 bytes
System Slot Information
\tDesignation: M2_1
\tType: x4 M.2 Socket 3
\tCurrent Usage: In Use
\tID: 3
\tBus Address: 0000:61:00.0

===PXEINV pcidev===
0000:40:01.1|0x060400|/sys/devices/pci0000:40/0000:40:01.1
0000:41:00.0|0x020000|/sys/devices/pci0000:40/0000:40:01.1/0000:41:00.0
0000:41:00.1|0x020000|/sys/devices/pci0000:40/0000:40:01.1/0000:41:00.1
0000:50:01.1|0x060400|/sys/devices/pci0000:50/0000:50:01.1
0000:60:01.2|0x060400|/sys/devices/pci0000:60/0000:60:01.2
0000:61:00.0|0x010802|/sys/devices/pci0000:60/0000:60:01.2/0000:61:00.0
0000:70:01.1|0x060400|/sys/devices/pci0000:70/0000:70:01.1
0000:71:00.0|0x010802|/sys/devices/pci0000:70/0000:70:01.1/0000:71:00.0
0000:70:01.2|0x060400|/sys/devices/pci0000:70/0000:70:01.2
0000:00:17.0|0x010601|/sys/devices/pci0000:00/0000:00:17.0
0000:80:00.0|0x010700|/sys/devices/pci0000:80/0000:80:00.0

===PXEINV lspci===
0000:41:00.0 "Ethernet controller" "Mellanox Technologies" "MT2910 Family [ConnectX-7]" -r00 "Mellanox Technologies" "Device 0026"
0000:41:00.1 "Ethernet controller" "Mellanox Technologies" "MT2910 Family [ConnectX-7]" -r00 "Mellanox Technologies" "Device 0026"
0000:61:00.0 "Non-Volatile memory controller" "Samsung Electronics Co Ltd" "NVMe SSD Controller PM9A3" -r00 "" ""
0000:00:17.0 "SATA controller" "Intel Corporation" "C620 Series Chipset SATA Controller" -r09 "" ""

===PXEINV hotplug===
1|0000:41:00|1
11|0000:71:00|1
12|0000:72:00|0

===PXEINV enclosure===
0:0:8:0|Slot00|0|OK|sda
0:0:8:0|Slot01|1|Not Installed|
0:0:8:0|Slot02|2|Not Installed|
0:0:8:0|Slot03|3|Unknown|

===PXEINV ata===
ata1|0000:00:17.0|sdb
ata2|0000:00:17.0|

===PXEINV nvme===
nvme0|0000:61:00.0|nvme0n1
nvme1|0000:71:00.0|nvme1n1

===PXEINV netlink===
ens1f0np0|1|up|100000|0000:41:00.0|bond0|74:25:54:00:00:01
ens1f1np1|0|down||0000:41:00.1||74:25:54:00:00:02
eno1||down||0000:05:00.0||30:56:0f:00:00:44
usb0|0|down||1-1.4:1.0||4a:00:00:00:00:01

===PXEINV ipaddr===
[{"ifname":"bond0","addr_info":[{"family":"inet","local":"10.0.0.5","prefixlen":24,"scope":"global"}]},{"ifname":"ens1f1np1","addr_info":[{"family":"inet6","local":"fe80::1","prefixlen":64,"scope":"link"}]}]

===PXEINV ibports===
mlx5_0|1|4: ACTIVE|5: LinkUp|100 Gb/sec (2X NDR)|Ethernet|0000:41:00.0|ens1f0np0
mlx5_4|1|4: ACTIVE|5: LinkUp|400 Gb/sec (4X NDR)|InfiniBand|0000:90:00.0|
mlx5_5|1|1: DOWN|2: Polling|10 Gb/sec (4X SDR)|InfiniBand|0000:91:00.0|

===PXEINV end===
`;

test("the collection script reads every port section", () => {
  for (const section of ["slots", "pcidev", "lspci", "hotplug", "enclosure", "ata", "nvme", "netlink", "ipaddr", "ibports"]) {
    assert.match(INVENTORY_SCRIPT, new RegExp(`sec ${section}\\n`));
  }
  assert.ok(INVENTORY_SCRIPT.indexOf("sec ibports") < INVENTORY_SCRIPT.indexOf("sec end"));
  assert.ok(splitSections(OUTPUT).has("end"));
});

test("lists PCIe slots, drive bays and network ports with their usage", () => {
  const { ports } = parseOsInventory(OUTPUT);
  const by = (group: string) => ports.filter((port) => port.group === group).map((port) => [port.name, port.used, port.device]);

  assert.deepEqual(by("pcie"), [
    ["PCIE1", true, "Mellanox MT2910 Family [ConnectX-7]"],
    ["PCIE2", false, ""],
  ], "BIOS 报空闲但插着网卡的，按找到的设备算占用；网卡的两个 function 只算一次；热插拔槽 1 是 PCIE1 本身，不重复列");

  assert.deepEqual(by("drive"), [
    ["M2_1", true, "nvme0n1 SAMSUNG MZ1L2960 960 GB"],
    ["热插拔槽 11", true, "nvme1n1 SOLIDIGM SB5PH27X076T 7682 GB"],
    ["热插拔槽 12", false, ""],
    ["Slot00", true, "sda ST4000NM 4001 GB"],
    ["Slot01", false, ""],
    ["Slot02", false, ""],
    ["Slot03", null, ""],
    ["SATA ata1", true, "sdb INTEL SSDSC2KB48 480 GB"],
    ["SATA ata2", false, ""],
    ["sdc", true, "MR9560 VD 960 GB"],
  ]);
  assert.equal(ports.find((port) => port.name === "热插拔槽 11")?.type, "NVMe");
  assert.match(ports.find((port) => port.name === "sdc")?.note || "", /没对上盘位/);

  const net = ports.filter((port) => port.group === "net");
  assert.deepEqual(
    net.map((port) => [port.name, port.link, port.speed, port.ips, port.master]),
    [
      ["ens1f0np0", "up", "100G", [], "bond0（10.0.0.5/24）"],
      ["ens1f1np1", "down", "", [], undefined],
      ["eno1", "disabled", "", [], undefined],
      ["mlx5_4 口 1", "up", "400G", [], undefined],
      ["mlx5_5 口 1", "down", "", [], undefined],
    ],
    "USB 虚拟网口不算；有网口名的 RDMA 口不重复列；只算全局地址",
  );

  assert.equal(portSummary(ports, "pcie"), "PCIe 插槽 2 个：占用 1，空闲 1");
  assert.equal(portSummary(ports, "drive"), "硬盘位 10 个：占用 5，空闲 4，不确定 1");
  assert.equal(portSummary(ports, "net"), "网口 5 个：有链路 2，没链路 3，配了地址 1");
});

/** 技嘉 G894：BIOS 一个 SXM 槽报 4 条（设备 + 交换芯片下行口）、一堆 NotAvailable；网卡开了 SR-IOV 和 switchdev。 */
const G894 = `
===PXEINV slots===
Handle 0x0030, DMI type 9, 17 bytes
System Slot Information
\tDesignation: SXM1_GPU0
\tType: x16 PCI Express 5 x16
\tCurrent Usage: In Use
\tLength: Long
\tBus Address: 0000:71:00.0

Handle 0x0031, DMI type 9, 17 bytes
System Slot Information
\tDesignation: SXM1_GPU0
\tType: x16 PCI Express 5 x16
\tCurrent Usage: Unknown
\tLength: Long
\tBus Address: 0000:70:01.2

Handle 0x0032, DMI type 9, 17 bytes
System Slot Information
\tDesignation: NotAvailable
\tType: <OUT OF SPEC> <OUT OF SPEC>
\tCurrent Usage: Unknown
\tBus Address: Unknown

Handle 0x0033, DMI type 9, 17 bytes
System Slot Information
\tDesignation: NotAvailable
\tType: <OUT OF SPEC> <OUT OF SPEC>
\tCurrent Usage: Unknown
\tBus Address: Unknown

===PXEINV pcidev===
0000:70:01.2|0x060400|/sys/devices/pci0000:70/0000:70:01.2
0000:71:00.0|0x020000|/sys/devices/pci0000:70/0000:70:01.2/0000:71:00.0
0000:03:00.0|0x020000|/sys/devices/pci0000:00/0000:03:00.0
0000:03:00.1|0x020000|/sys/devices/pci0000:00/0000:03:00.1
0000:03:00.2|0x020000|/sys/devices/pci0000:00/0000:03:00.2

===PXEINV lspci===
0000:71:00.0 "Ethernet controller" "Mellanox Technologies" "CX8 Family [ConnectX-8]" -r00 "" ""

===PXEINV netlink===
eth_p1_r1|1|up|400000|0000:03:00.0||74:25:54:5d:35:c2|p0|
eth_p2_r1|1|up|400000|0000:03:00.1||74:25:54:5d:35:c3|p1|
eth_rep_r1|1|up||0000:03:00.0||e2:c3:e6:62:8c:9b|pf0vf0|
eth_vf_r1|1|up|400000|0000:03:00.2||00:89:cb:25:00:00||0000:03:00.0

===PXEINV ipaddr===
[{"ifname":"eth_vf_r1","addr_info":[{"family":"inet","local":"43.0.11.70","prefixlen":31,"scope":"global"}]}]

===PXEINV end===
`;

test("one row per BIOS slot name; VFs and representors are not ports of their own", () => {
  const { ports } = parseOsInventory(G894);
  assert.deepEqual(
    ports.filter((port) => port.group === "pcie").map((port) => [port.name, port.used, port.device]),
    [["SXM1_GPU0", true, "Mellanox CX8 Family [ConnectX-8]"]],
    "同名的 4 条合成一条，NotAvailable 占位不列",
  );
  assert.deepEqual(
    ports.filter((port) => port.group === "net").map((port) => [port.name, port.ips, port.note]),
    [
      ["eth_p1_r1", ["43.0.11.70/31"], "地址配在 VF eth_vf_r1 上"],
      ["eth_p2_r1", [], undefined],
    ],
  );
});

test("older collections without the port sections still parse", () => {
  const { ports } = parseOsInventory("===PXEINV end===\n");
  assert.deepEqual(ports, []);
  assert.equal(portSummary(ports, "net"), "网口：没读到");
});

test("maps Redfish slots, drives and adapter ports", () => {
  const raw = {
    processors: [
      { "@odata.id": "/c/0", Id: "CPU0", Socket: "CPU0", ProcessorType: "CPU", Model: "Xeon 8480", TotalCores: 56, Status: { State: "Enabled" } },
      { "@odata.id": "/c/1", Id: "CPU1", Socket: "CPU1", ProcessorType: "CPU", Status: { State: "Absent" } },
      { "@odata.id": "/c/g", Id: "GPU_0", ProcessorType: "GPU", Model: "B300", Status: { State: "Enabled" } },
    ],
    memory: [
      { "@odata.id": "/m/0", Id: "DIMM_A0", DeviceLocator: "DIMM_A0", PartNumber: "M321", CapacityMiB: 65536, MemoryDeviceType: "DDR5", BaseModuleType: "RDIMM", Status: { State: "Enabled" } },
      { "@odata.id": "/m/1", Id: "DIMM_A1", DeviceLocator: "DIMM_A1", BaseModuleType: "RDIMM", Status: { State: "Absent" } },
      { "@odata.id": "/m/g", Id: "GPU_0_DRAM_0", CapacityMiB: 275040, MemoryDeviceType: "HBM", Status: { State: "Enabled" } },
    ],
    pcieDevices: [{ "@odata.id": "/redfish/v1/Chassis/Self/PCIeDevices/00_41_00", Id: "00_41_00", Name: "ConnectX-7" }],
    pcieSlots: [
      {
        "@odata.id": "/redfish/v1/Chassis/Self/PCIeSlots",
        Id: "PCIeSlots",
        Slots: [
          { PCIeType: "Gen5", Lanes: 16, SlotType: "FullLength", Location: { PartLocation: { ServiceLabel: "Slot 1" } }, Status: { State: "Enabled" }, Links: { PCIeDevice: [{ "@odata.id": "/redfish/v1/Chassis/Self/PCIeDevices/00_41_00" }] } },
          { PCIeType: "Gen5", Lanes: 16, Location: { PartLocation: { ServiceLabel: "Slot 2" } }, Status: { State: "Absent" } },
        ],
      },
    ],
    drives: [
      { "@odata.id": "/d/0", Id: "0", Name: "Disk Bay 0", Model: "ST4000NM", CapacityBytes: 4000787030016, Protocol: "SAS", Status: { State: "Enabled" } },
      { "@odata.id": "/d/1", Id: "1", Name: "Disk Bay 1", Status: { State: "Absent" } },
    ],
    networkPorts: [
      { "@odata.id": "/p/1", Id: "1", _adapter: "ConnectX-7", LinkStatus: "LinkUp", CurrentSpeedGbps: 100, PortProtocol: "Ethernet", Ethernet: { AssociatedMACAddresses: ["74:25:54:00:00:01"] } },
      { "@odata.id": "/p/2", Id: "2", _adapter: "ConnectX-7", LinkStatus: "Down", CurrentLinkSpeedMbps: 0 },
    ],
  } as unknown as RedfishRaw;
  const ports = redfishPorts(raw);
  assert.deepEqual(
    ports.map((port) => [port.group, port.name, port.type, port.used, port.device]),
    [
      ["cpu", "CPU0", "", true, "Xeon 8480"],
      ["cpu", "CPU1", "", false, ""],
      ["memory", "DIMM_A0", "DDR5 RDIMM", true, "M321 64 GB"],
      ["memory", "DIMM_A1", "RDIMM", false, ""],
      ["pcie", "Slot 1", "PCIe Gen5 x16 FullLength", true, "ConnectX-7"],
      ["pcie", "Slot 2", "PCIe Gen5 x16", false, ""],
      ["drive", "Disk Bay 0", "SAS", true, "ST4000NM 4001 GB"],
      ["drive", "Disk Bay 1", "", false, ""],
      ["net", "ConnectX-7 口 1", "Ethernet", true, ""],
      ["net", "ConnectX-7 口 2", "", false, ""],
    ],
  );
  assert.equal(ports[8].speed, "100G");
  assert.equal(ports[8].mac, "74:25:54:00:00:01");
});

test("NVMe and M.2 slots from the BMC count as drive bays and carry their drive (Gigabyte G894)", () => {
  const device = (bus: string, model: string) => ({ "@odata.id": `/redfish/v1/Chassis/Self/PCIeDevices/${bus}`, Id: bus, Model: model });
  const slot = (labelText: string, lanes: number, links: string[]) => ({
    PCIeType: "Gen5",
    Lanes: lanes,
    Location: { PartLocation: { ServiceLabel: labelText } },
    Status: { State: links.length ? "Enabled" : "Absent" },
    ...(links.length ? { Links: { PCIeDevice: links.map((bus) => ({ "@odata.id": `/redfish/v1/Chassis/Self/PCIeDevices/${bus}` })) } } : {}),
  });
  // 和真机一样：Id 是 NVMe0_NameSpace1 这种，总线编号在 Name 里。
  const drive = (driveId: string, model: string, bytes: number) => ({ "@odata.id": `/redfish/v1/Systems/Self/Storage/S/Drives/${driveId}`, Id: `NVMe${driveId.slice(3, 5)}_NameSpace1`, Name: driveId, Model: model, CapacityBytes: bytes, Protocol: "NVMe", Status: { State: "Enabled" } });
  const raw = {
    processors: [],
    memory: [],
    pcieDevices: [device("00_2D_00", "NVMe DC SSD [Atomos Prime]"), device("00_33_00", "ConnectX-7"), device("00_51_00", "ASM1166"), device("00_54_00", "SSSTC NVMe")],
    pcieSlots: [{ "@odata.id": "/redfish/v1/Chassis/Self/PCIeSlots", Id: "PCIeSlots", Slots: [slot("SLOT1", 16, ["00_33_00"]), slot("P0_M.2", 32, ["00_51_00", "00_54_00"]), slot("NVME3", 4, ["00_2D_00"]), slot("NVME7", 4, [])] }],
    drives: [drive("00_2D_00_00", "SOLIDIGM SB5PH27X076T", 7681501126656), drive("00_54_00_00", "SSSTC CA6-8D1024", 1024209543168), drive("00_99_00_00", "Other", 1e12)],
    networkPorts: [],
  } as unknown as RedfishRaw;
  assert.deepEqual(
    redfishPorts(raw).map((port) => [port.group, port.name, port.type, port.used, port.device, port.note || ""]),
    [
      ["pcie", "SLOT1", "PCIe Gen5 x16", true, "ConnectX-7", ""],
      ["drive", "NVME3", "NVMe（PCIe Gen5 x4）", true, "SOLIDIGM SB5PH27X076T 7682 GB", ""],
      ["drive", "NVME7", "NVMe（PCIe Gen5 x4）", false, "", ""],
      ["drive", "P0_M.2", "M.2（PCIe Gen5 x32）", true, "SSSTC CA6-8D1024 1024 GB", ""],
      ["drive", "00_99_00_00", "NVMe", true, "Other 1000 GB", "没对上盘位"],
    ],
  );
});

test("interfaces list the parts plugged into them", async () => {
  const { interfaceView } = await import("./ports.ts");
  const part = (kind: HwComponent["kind"], slot: string, attrs: HwComponent["attrs"] = {}): HwComponent => ({ kind, slot, model: slot, vendor: "", sn: "", firmware: "", attrs });
  const gpu = part("gpu", "0000:06:00.0");
  const nic = part("nic", "eth_p1_r1", { pci: "0000:03:00.0" });
  const disk = part("disk", "nvme1n1");
  const old = part("disk", "nvme2n1");
  const loose = part("disk", "nvme0n1");
  const mezz = part("nic", "ib0", { pci: "0000:d9:00.0" });
  const cpu = part("cpu", "P0");
  const dimm = part("memory", "DIMM_P0_A0");
  const optic = part("transceiver", "eth_p1_r1, eth_p2_r1");
  const bios = part("firmware", "BIOS");
  const ports: HwPort[] = [
    { group: "cpu", name: "P0", type: "Socket SP5", used: true, device: "", parts: ["P0"] },
    { group: "cpu", name: "P1", type: "Socket SP5", used: false, device: "" },
    { group: "memory", name: "DIMM_P0_A0", type: "DDR5 DIMM", used: true, device: "", parts: ["DIMM_P0_A0"] },
    { group: "pcie", name: "SXM1_GPU0", type: "", used: true, device: "CX8；NVIDIA Device 3182", parts: ["0000:03:00.0", "0000:03:00.1", "0000:06:00.0"] },
    { group: "drive", name: "NVME3", type: "", used: true, device: "nvme1n1 SOLIDIGM 7682 GB", parts: ["0000:a1:00.0", "nvme1n1"] },
    // 以前的采集没有 parts：按盘符对。
    { group: "drive", name: "NVME2", type: "", used: true, device: "nvme2n1 SOLIDIGM 7682 GB" },
    { group: "drive", name: "nvme0n1", type: "NVMe", used: true, device: "SSSTC 1024 GB", note: "没对上盘位" },
    { group: "net", name: "eth_p1_r1", type: "", used: true, device: "" },
    { group: "net", name: "eth_p2_r1", type: "", used: true, device: "" },
  ];
  const view = interfaceView([bios, cpu, dimm, gpu, nic, disk, old, loose, mezz, optic], ports);
  const at = (name: string) => (view.parts.get(ports.find((port) => port.name === name)!) || []).map((item) => item.slot);
  assert.deepEqual(view.groups.map((group) => [group.group, group.ports.length]), [["cpu", 2], ["memory", 1], ["pcie", 1], ["drive", 3], ["net", 2]]);
  assert.deepEqual(at("P0"), ["P0"]);
  assert.deepEqual(at("P1"), []);
  assert.deepEqual(at("DIMM_P0_A0"), ["DIMM_P0_A0"]);
  assert.deepEqual(at("SXM1_GPU0"), ["0000:06:00.0", "eth_p1_r1"]);
  assert.deepEqual(at("NVME3"), ["nvme1n1"]);
  assert.deepEqual(at("NVME2"), ["nvme2n1"]);
  assert.deepEqual(at("nvme0n1"), ["nvme0n1"]);
  assert.deepEqual(at("eth_p2_r1"), ["eth_p1_r1, eth_p2_r1"]);
  assert.deepEqual(view.machine, [bios]);
  assert.deepEqual(view.loose, [mezz]);
});

test("old snapshots without CPU and memory slots get them from the parts", async () => {
  const { interfaceView } = await import("./ports.ts");
  const cpu: HwComponent = { kind: "cpu", slot: "P0", model: "EPYC", vendor: "", sn: "", firmware: "", attrs: {} };
  const psu: HwComponent = { kind: "psu", slot: "PSU1", model: "", vendor: "", sn: "", firmware: "", attrs: {} };
  const view = interfaceView([cpu, psu], undefined);
  assert.deepEqual(view.groups.map((group) => [group.group, group.ports.map((port) => port.name), Boolean(group.fromParts)]), [
    ["cpu", ["P0"], true],
    ["memory", [], false],
    ["pcie", [], false],
    ["drive", [], false],
    ["net", [], false],
    ["psu", ["PSU1"], false],
  ]);
  assert.deepEqual(view.parts.get(view.groups[0].ports[0]), [cpu]);
  assert.deepEqual(view.loose, []);
});

test("CPU sockets and memory slots include the empty ones", () => {
  const output = `
===PXEINV dmidecode===
Handle 0x0040, DMI type 4, 48 bytes
Processor Information
\tSocket Designation: P0
\tManufacturer: Advanced Micro Devices, Inc.
\tVersion: AMD EPYC 9555 64-Core Processor
\tStatus: Populated, Enabled
\tUpgrade: Socket SP5
\tCore Count: 64

Handle 0x0041, DMI type 4, 48 bytes
Processor Information
\tSocket Designation: P1
\tVersion: Not Specified
\tStatus: Unpopulated
\tUpgrade: Socket SP5

Handle 0x0050, DMI type 17, 92 bytes
Memory Device
\tSize: 128 GB
\tForm Factor: DIMM
\tLocator: DIMM_P0_A0
\tType: DDR5
\tPart Number: M321RAJA0MB2-CCPWC
\tSerial Number: DIMMA0

Handle 0x0051, DMI type 17, 92 bytes
Memory Device
\tSize: No Module Installed
\tForm Factor: DIMM
\tLocator: DIMM_P0_A1
\tType: Unknown

===PXEINV end===
`;
  const parsed = parseOsInventory(output);
  assert.deepEqual(
    parsed.ports.filter((port) => port.group === "cpu" || port.group === "memory").map((port) => [port.group, port.name, port.type, port.used, port.device]),
    [
      ["cpu", "P0", "Socket SP5", true, "AMD EPYC 9555 64-Core Processor"],
      ["cpu", "P1", "Socket SP5", false, ""],
      ["memory", "DIMM_P0_A0", "DDR5 DIMM", true, "M321RAJA0MB2-CCPWC 128 GB"],
      ["memory", "DIMM_P0_A1", "DIMM", false, ""],
    ],
  );
  assert.equal(portSummary(parsed.ports, "memory"), "内存槽 2 个：占用 1，空闲 1");
});

test("old BMC snapshots without parts: only a unique model and capacity is matched to a bay", async () => {
  const { interfaceView } = await import("./ports.ts");
  const disk = (slot: string, model: string, capacityGB: number): HwComponent => ({ kind: "disk", slot, model, vendor: "", sn: slot, firmware: "", attrs: { capacityGB } });
  const same0 = disk("NVMe0_NameSpace1", "SOLIDIGM SB5PH27X076T", 7682);
  const same1 = disk("NVMe1_NameSpace1", "SOLIDIGM SB5PH27X076T", 7682);
  const m2 = disk("NVMe4_NameSpace1", "SSSTC CA6-8D1024", 1024);
  const ports: HwPort[] = [
    { group: "drive", name: "NVME0", type: "", used: true, device: "SOLIDIGM SB5PH27X076T 7682 GB" },
    { group: "drive", name: "NVME1", type: "", used: true, device: "SOLIDIGM SB5PH27X076T 7682 GB" },
    { group: "drive", name: "P0_M.2", type: "", used: true, device: "SSSTC CA6-8D1024 1024 GB" },
  ];
  const view = interfaceView([same0, same1, m2], ports);
  assert.deepEqual(view.parts.get(ports[2]), [m2]);
  assert.equal(view.parts.has(ports[0]), false, "同型号的盘分不出盘位，不硬配");
  assert.deepEqual(view.loose, [same0, same1]);
  assert.equal(view.unmapped, true);
  assert.equal(interfaceView([m2], [{ ...ports[2], parts: ["NVMe4_NameSpace1"] }]).unmapped, false);
});
