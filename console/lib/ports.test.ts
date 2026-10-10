import assert from "node:assert/strict";
import test from "node:test";
import { INVENTORY_SCRIPT, parseOsInventory, splitSections } from "./inventory.ts";
import { portSummary, redfishPorts } from "./ports.ts";
import type { RedfishRaw } from "./redfish.ts";

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

test("older collections without the port sections still parse", () => {
  const { ports } = parseOsInventory("===PXEINV end===\n");
  assert.deepEqual(ports, []);
  assert.equal(portSummary(ports, "net"), "网口：没读到");
});

test("maps Redfish slots, drives and adapter ports", () => {
  const raw = {
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
      ["pcie", "Slot 1", "PCIe Gen5 x16 FullLength", true, "ConnectX-7"],
      ["pcie", "Slot 2", "PCIe Gen5 x16", false, ""],
      ["drive", "Disk Bay 0", "SAS", true, "ST4000NM 4001 GB"],
      ["drive", "Disk Bay 1", "", false, ""],
      ["net", "ConnectX-7 口 1", "Ethernet", true, ""],
      ["net", "ConnectX-7 口 2", "", false, ""],
    ],
  );
  assert.equal(ports[4].speed, "100G");
  assert.equal(ports[4].mac, "74:25:54:00:00:01");
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
