import type { RedfishDoc, RedfishRaw } from "./redfish.ts";
import type { HwComponent, HwPort, PortGroup } from "./types.ts";

/**
 * 盘位、PCIe 插槽、网口和各自的占用情况，跟着硬件采集一起读。只用来看还有哪些口空着，不参与变化比对和基准检查。
 *
 * 系统内：PCIe 插槽和 M.2 槽来自 BIOS 的 SMBIOS 表（dmidecode -t 9），再按总线地址找插在上面的设备；
 * 盘位来自背板的 SES（/sys/class/enclosure）、板载 SATA 口（/sys/class/ata_port）和 PCIe 热插拔槽（多为 NVMe 盘位），
 * 对不上盘位的盘单独列出；网口读链路、速率、IP 和所属 bond，IB 模式的口没有网口名，按 RDMA 设备列。
 * BMC：Chassis 的 PCIeSlots、Storage 里的盘位（有的 BMC 会列出空盘位）、网卡的 Ports。
 */

export const PORT_GROUP_LABEL: Record<PortGroup, string> = {
  drive: "硬盘位",
  pcie: "PCIe 插槽",
  net: "网口",
};

/** 接在 INVENTORY_SCRIPT 里执行，用它的 sec、have、pci_of。字段用 | 分隔，因为有的值会是空的。 */
export const PORTS_BODY = String.raw`sec slots
have dmidecode && dmidecode -t 9 2>/dev/null
sec pcidev
for d in /sys/bus/pci/devices/*; do echo "$(basename "$d")|$(cat "$d/class" 2>/dev/null)|$(readlink -f "$d")"; done
sec lspci
have lspci && lspci -D -mm 2>/dev/null
sec hotplug
for s in /sys/bus/pci/slots/*; do
  [ -e "$s/address" ] || continue
  echo "$(basename "$s")|$(cat "$s/address" 2>/dev/null)|$(cat "$s/adapter" 2>/dev/null)"
done
sec enclosure
for c in /sys/class/enclosure/*/*; do
  [ -f "$c/type" ] || continue
  case "$(cat "$c/type" 2>/dev/null)" in *device*) ;; *) continue ;; esac
  echo "$(basename "$(dirname "$c")")|$(basename "$c")|$(cat "$c/slot" 2>/dev/null)|$(cat "$c/status" 2>/dev/null)|$(ls "$c/device/block" 2>/dev/null | head -n 1)"
done
sec ata
for p in /sys/class/ata_port/ata*; do
  [ -e "$p/device" ] || continue
  b=$(ls -d "$p"/device/host*/target*/*/block/* 2>/dev/null | head -n 1)
  echo "$(basename "$p")|$(basename "$(dirname "$(readlink -f "$p/device")")")|$(basename "$b" 2>/dev/null)"
done
sec nvme
for n in /sys/class/nvme/nvme*; do
  [ -e "$n/device" ] || continue
  echo "$(basename "$n")|$(pci_of "$n")|$(ls "$n" 2>/dev/null | grep -m 1 -E '^nvme[0-9]+n[0-9]+$')"
done
sec netlink
for n in /sys/class/net/*; do
  [ -e "$n/device" ] || continue
  echo "$(basename "$n")|$(cat "$n/carrier" 2>/dev/null)|$(cat "$n/operstate" 2>/dev/null)|$(cat "$n/speed" 2>/dev/null)|$(pci_of "$n")|$(basename "$(readlink "$n/master" 2>/dev/null)" 2>/dev/null)|$(cat "$n/address" 2>/dev/null)"
done
sec ipaddr
have ip && ip -j addr 2>/dev/null
sec ibports
for p in /sys/class/infiniband/*/ports/*; do
  [ -e "$p/state" ] || continue
  d=$(dirname "$(dirname "$p")")
  echo "$(basename "$d")|$(basename "$p")|$(cat "$p/state" 2>/dev/null)|$(cat "$p/phys_state" 2>/dev/null)|$(cat "$p/rate" 2>/dev/null)|$(cat "$p/link_layer" 2>/dev/null)|$(pci_of "$d")|$(ls "$d/device/net" 2>/dev/null | tr '\n' ' ')"
done
`;

const PCI_ADDRESS = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/i;

function rows(text: string | undefined, width: number): string[][] {
  return (text || "")
    .split("\n")
    .filter((line) => line.includes("|"))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      while (cells.length < width) cells.push("");
      return cells;
    });
}

interface PciDev {
  addr: string;
  cls: string;
  path: string;
}

/** lspci -mm 一行：0000:41:00.0 "Ethernet controller" "Mellanox Technologies" "MT2910 Family [ConnectX-7]" ... */
function parseLspci(text: string | undefined): Map<string, { cls: string; name: string }> {
  const out = new Map<string, { cls: string; name: string }>();
  for (const line of (text || "").split("\n")) {
    const addr = line.split(/\s+/)[0]?.toLowerCase() || "";
    if (!PCI_ADDRESS.test(addr)) continue;
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    const vendor = (quoted[1] || "").split(/[\s,]+/)[0];
    const device = quoted[2] || "";
    out.set(addr, { cls: quoted[0] || "", name: [vendor, device].filter(Boolean).join(" ") });
  }
  return out;
}

function gbps(mbps: number): string {
  if (!(mbps > 0)) return "";
  return mbps >= 1000 ? `${Math.round((mbps / 1000) * 10) / 10}G` : `${mbps}M`;
}

/** 把一组设备名合成一句：同一张卡的几个 function 只算一次，太多时只列前三种。 */
function deviceText(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  const parts = [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  return parts.length > 3 ? `${parts.slice(0, 3).join("；")} 等 ${parts.length} 种` : parts.join("；");
}

/** dmidecode 的插槽类型，例如 "x16 PCI Express 5 x16" → "PCIe Gen5 x16"。 */
function slotType(type: string, length: string): string {
  let text = type.trim();
  const pcie = /PCI Express\s*(\d)?/i.exec(text);
  const lanes = /x(\d+)/i.exec(text);
  if (pcie) text = `PCIe${pcie[1] ? ` Gen${pcie[1]}` : ""}${lanes ? ` x${lanes[1]}` : ""}`;
  if (/M\.2/i.test(type)) text = type.replace(/^x\d+\s+/, "");
  const len = /^(Long|Short|Half|Full)/i.test(length) ? `（${length}）` : "";
  return `${text}${len}`;
}

function diskText(disk: HwComponent | undefined, name: string): string {
  if (!disk) return name;
  const cap = disk.attrs.capacityGB ? `${disk.attrs.capacityGB} GB` : "";
  return [name, disk.model, cap].filter(Boolean).join(" ");
}

/** 解析 PORTS_BODY 的输出。components 是同一次采集解析出的部件，用来给盘和网口配上型号。 */
export function parseOsPorts(sections: Map<string, string>, components: HwComponent[], parseDmidecode: (text: string) => { type: number; fields: Record<string, string> }[]): HwPort[] {
  const ports: HwPort[] = [];
  const disks = new Map(components.filter((item) => item.kind === "disk").map((item) => [item.slot, item]));
  const nics = new Map(components.filter((item) => item.kind === "nic").map((item) => [item.slot, item]));
  const lspci = parseLspci(sections.get("lspci"));
  const pcidevs: PciDev[] = rows(sections.get("pcidev"), 3)
    .map(([addr, cls, path]) => ({ addr: addr.toLowerCase(), cls: cls.toLowerCase(), path }))
    .filter((dev) => PCI_ADDRESS.test(dev.addr));
  const nvmeByPci = new Map<string, string>();
  for (const [, pci, ns] of rows(sections.get("nvme"), 3)) if (ns) nvmeByPci.set(pci.toLowerCase(), ns);
  const usedDisks = new Set<string>();
  const claimed = new Set<string>();

  /** 地址本身或挂在它下面的终端设备（桥不算）。 */
  const endpointsUnder = (addr: string) => pcidevs.filter((dev) => !dev.cls.startsWith("0x06") && (dev.addr === addr || dev.path.includes(`/${addr}/`)));
  const describe = (devs: PciDev[]) =>
    deviceText(
      devs
        .filter((dev, index) => devs.findIndex((other) => other.addr.slice(0, -2) === dev.addr.slice(0, -2) && lspci.get(other.addr)?.name === lspci.get(dev.addr)?.name) === index)
        .map((dev) => {
          const ns = nvmeByPci.get(dev.addr);
          if (ns) {
            usedDisks.add(ns);
            return diskText(disks.get(ns), ns);
          }
          return lspci.get(dev.addr)?.name || dev.addr;
        }),
    );

  // PCIe 插槽和 M.2 槽：BIOS 报的占用不一定准，找到设备就算占用。
  const slotIds = new Set<string>();
  const slotPrefixes = new Set<string>();
  const dmi = parseDmidecode(sections.get("slots") || "").filter((block) => block.type === 9);
  for (const { fields } of dmi) {
    const addr = (fields["Bus Address"] || "").toLowerCase();
    const valid = PCI_ADDRESS.test(addr) && !/^[0-9a-f]{4}:ff:/.test(addr) && !/^0000:00:00\.0$/.test(addr);
    const devs = valid ? endpointsUnder(addr) : [];
    devs.forEach((dev) => claimed.add(dev.addr));
    if (valid) slotPrefixes.add(addr.slice(0, -2));
    if (fields.ID) slotIds.add(fields.ID);
    const usage = fields["Current Usage"] || "";
    const used = devs.length ? true : /in use/i.test(usage) ? true : /available/i.test(usage) ? false : null;
    const m2 = /M\.2/i.test(fields.Type || "");
    ports.push({
      group: m2 ? "drive" : "pcie",
      name: fields.Designation || `插槽 ${fields.ID || ports.length + 1}`,
      type: slotType(fields.Type || "", fields.Length || ""),
      used,
      device: describe(devs),
      ...(used && !devs.length ? { note: "BIOS 报占用，系统里没找到设备" } : {}),
      ...(!valid ? { note: "BIOS 没给总线地址，占用按 BIOS 报的" } : {}),
    });
  }

  // 热插拔槽：没在 SMBIOS 表里的，装着 NVMe 的算盘位，其余的列进 PCIe。
  // 空槽看不出是什么，别的热插拔槽里有 NVMe 时按 NVMe 盘位算。
  const hotplug = rows(sections.get("hotplug"), 3)
    .filter(([name, address]) => !slotIds.has(name) && !slotPrefixes.has(address.toLowerCase()))
    .map(([name, address, adapter]) => {
      const devs = pcidevs.filter((dev) => dev.addr.startsWith(`${address.toLowerCase()}.`)).flatMap((dev) => endpointsUnder(dev.addr));
      return { name, adapter, devs: devs.filter((dev, index) => devs.findIndex((other) => other.addr === dev.addr) === index) };
    })
    .filter((slot) => !slot.devs.length || !slot.devs.every((dev) => claimed.has(dev.addr)));
  const nvmeBays = hotplug.some((slot) => slot.devs.some((dev) => dev.cls.startsWith("0x0108")));
  for (const { name, adapter, devs } of hotplug) {
    devs.forEach((dev) => claimed.add(dev.addr));
    const nvme = devs.length ? devs.some((dev) => dev.cls.startsWith("0x0108")) : nvmeBays;
    const used = devs.length ? true : adapter === "1" ? true : adapter === "0" ? false : null;
    ports.push({
      group: nvme ? "drive" : "pcie",
      name: `热插拔槽 ${name}`,
      type: nvme ? "NVMe" : "PCIe 热插拔",
      used,
      device: describe(devs),
      ...(!devs.length ? { note: nvme ? "空槽，按同一批热插拔槽里装着 NVMe 推测是 NVMe 盘位" : "空的热插拔槽，可能是 NVMe 盘位，也可能是交换芯片上没接东西的口" } : {}),
    });
  }

  // 背板盘位。
  const enclosures = rows(sections.get("enclosure"), 5);
  const multiEnclosure = new Set(enclosures.map((cells) => cells[0])).size > 1;
  for (const [encl, comp, slot, status, block] of enclosures) {
    if (block) usedDisks.add(block);
    const label = /^\d+$/.test(comp) ? `槽 ${slot || comp}` : comp;
    ports.push({
      group: "drive",
      name: multiEnclosure ? `背板 ${encl} ${label}` : label,
      type: "SAS/SATA 背板",
      used: block ? true : /not installed/i.test(status) ? false : /^ok$/i.test(status) ? true : null,
      device: block ? diskText(disks.get(block), block) : "",
    });
  }

  // 板载 SATA 口。
  for (const [port, controller, block] of rows(sections.get("ata"), 3)) {
    if (block && usedDisks.has(block)) continue;
    if (block) usedDisks.add(block);
    const ctl = lspci.get(controller.toLowerCase());
    ports.push({
      group: "drive",
      name: `SATA ${port}`,
      type: ctl?.name ? `SATA（${ctl.name}）` : "SATA",
      used: Boolean(block),
      device: block ? diskText(disks.get(block), block) : "",
    });
  }

  // 没对上任何盘位的盘：直连的 NVMe、RAID 卡或 HBA 后面没有 SES 的盘等。
  for (const [name, disk] of disks) {
    if (usedDisks.has(name)) continue;
    ports.push({
      group: "drive",
      name,
      type: String(disk.attrs.transport || disk.attrs.media || "").toUpperCase().replace("NVME", "NVMe"),
      used: true,
      device: diskText(disk, ""),
      note: "没对上盘位",
    });
  }

  // 网口：链路和 IP 都列出来，不替用户判断。
  const ipsOf = new Map<string, string[]>();
  try {
    const parsed = JSON.parse(sections.get("ipaddr") || "[]") as { ifname?: string; addr_info?: { local?: string; prefixlen?: number; scope?: string }[] }[];
    for (const item of parsed) {
      const list = (item.addr_info || []).filter((addr) => addr.scope === "global" && addr.local).map((addr) => `${addr.local}/${addr.prefixlen}`);
      if (item.ifname) ipsOf.set(item.ifname, list);
    }
  } catch {
    // ip 没装或输出不是 JSON，只是没有 IP 一列。
  }
  for (const [name, carrier, operstate, speed, pci, master, mac] of rows(sections.get("netlink"), 7)) {
    if (!PCI_ADDRESS.test(pci)) continue; // USB 网卡（比如 BMC 的虚拟网口）不算
    const link = carrier === "1" ? "up" : carrier === "0" ? "down" : operstate === "down" ? "disabled" : operstate === "up" ? "up" : "";
    const masterIps = master ? ipsOf.get(master) || [] : [];
    ports.push({
      group: "net",
      name,
      type: nics.get(name)?.model || lspci.get(pci.toLowerCase())?.name || "",
      used: link === "up" ? true : link ? false : null,
      device: "",
      link,
      speed: link === "up" ? gbps(Number(speed)) : "",
      ips: ipsOf.get(name) || [],
      ...(master ? { master: masterIps.length ? `${master}（${masterIps.join("，")}）` : master } : {}),
      mac,
    });
  }
  for (const [dev, port, state, phys, rate, layer, pci, netdevs] of rows(sections.get("ibports"), 8)) {
    if (netdevs.trim() || !/infiniband/i.test(layer)) continue;
    const link = /disabled/i.test(phys) ? "disabled" : /active/i.test(state) ? "up" : "down";
    const speed = /^(\d+)/.exec(rate);
    ports.push({
      group: "net",
      name: `${dev} 口 ${port}`,
      type: lspci.get(pci.toLowerCase())?.name || "InfiniBand",
      used: link === "up",
      device: "",
      link,
      speed: link === "up" && speed ? `${speed[1]}G` : "",
      ips: [],
      note: "InfiniBand 模式，没有网口名",
    });
  }
  return ports;
}

function str(doc: RedfishDoc | undefined, key: string): string {
  const value = doc?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function state(doc: RedfishDoc | undefined): string {
  return str(doc?.Status as RedfishDoc | undefined, "State");
}

function label(doc: RedfishDoc | undefined): string {
  const location = (doc?.Location || doc?.PhysicalLocation) as { PartLocation?: { ServiceLabel?: string } } | undefined;
  return location?.PartLocation?.ServiceLabel?.trim() || "";
}

function id(doc: RedfishDoc): string {
  return str(doc, "Id") || String(doc["@odata.id"] || "").split("/").filter(Boolean).pop() || "";
}

/** 从 crawlRedfish 读到的文档里取接口。 */
export function redfishPorts(raw: RedfishRaw): HwPort[] {
  const ports: HwPort[] = [];
  const devices = new Map(raw.pcieDevices.map((doc) => [String(doc["@odata.id"] || ""), doc]));

  for (const doc of raw.pcieSlots) {
    const slots = Array.isArray(doc.Slots) ? (doc.Slots as RedfishDoc[]) : [];
    slots.forEach((slot, index) => {
      const linked = ((slot.Links as { PCIeDevice?: { "@odata.id"?: string }[] } | undefined)?.PCIeDevice || [])
        .map((item) => devices.get(item?.["@odata.id"] || ""))
        .filter((item): item is RedfishDoc => Boolean(item));
      const slotState = state(slot);
      const lanes = Number(slot.Lanes) || 0;
      ports.push({
        group: "pcie",
        name: label(slot) || `${id(doc)} 插槽 ${index + 1}`,
        type: [str(slot, "PCIeType") && `PCIe ${str(slot, "PCIeType")}`, lanes && `x${lanes}`, str(slot, "SlotType")].filter(Boolean).join(" "),
        used: linked.length ? true : slotState === "Absent" ? false : slotState === "Enabled" ? true : null,
        device: deviceText(linked.map((item) => str(item, "Model") || str(item, "Name") || id(item))),
      });
    });
  }

  for (const doc of raw.drives) {
    const absent = state(doc) === "Absent";
    const bytes = Number(doc.CapacityBytes) || 0;
    ports.push({
      group: "drive",
      name: label(doc) || str(doc, "Name") || id(doc),
      type: [str(doc, "Protocol"), str(doc, "FormFactor")].filter(Boolean).join(" "),
      used: !absent,
      device: absent ? "" : [str(doc, "Model"), bytes ? `${Math.round(bytes / 1e9)} GB` : ""].filter(Boolean).join(" "),
    });
  }

  for (const doc of raw.networkPorts) {
    const status = str(doc, "LinkStatus");
    const disabled = str(doc, "LinkState") === "Disabled" || state(doc) === "Disabled";
    const link = disabled ? "disabled" : /up/i.test(status) ? "up" : /down|nolink/i.test(status) ? "down" : "";
    const speedGbps = Number(doc.CurrentSpeedGbps) || (Number(doc.CurrentLinkSpeedMbps) || 0) / 1000;
    const ethernet = doc.Ethernet as { AssociatedMACAddresses?: string[] } | undefined;
    const addresses = Array.isArray(doc.AssociatedNetworkAddresses) ? (doc.AssociatedNetworkAddresses as string[]) : [];
    ports.push({
      group: "net",
      name: `${str(doc, "_adapter")} 口 ${id(doc)}`.trim(),
      type: str(doc, "PortProtocol") || str(doc, "ActiveLinkTechnology"),
      used: link === "up" ? true : link ? false : null,
      device: "",
      link,
      speed: link === "up" && speedGbps ? `${Math.round(speedGbps * 10) / 10}G` : "",
      ips: [],
      mac: ethernet?.AssociatedMACAddresses?.[0] || addresses[0] || "",
    });
  }
  return ports;
}

/** 一组接口的计数，页面标题和任务输出用。 */
export function portSummary(ports: HwPort[], group: PortGroup): string {
  const list = ports.filter((port) => port.group === group);
  if (!list.length) return `${PORT_GROUP_LABEL[group]}：没读到`;
  if (group === "net") {
    const up = list.filter((port) => port.link === "up").length;
    const withIp = list.filter((port) => port.ips?.length || port.master).length;
    return `${PORT_GROUP_LABEL[group]} ${list.length} 个：有链路 ${up}，没链路 ${list.length - up}，配了地址 ${withIp}`;
  }
  const used = list.filter((port) => port.used === true).length;
  const free = list.filter((port) => port.used === false).length;
  const unknown = list.length - used - free;
  return `${PORT_GROUP_LABEL[group]} ${list.length} 个：占用 ${used}，空闲 ${free}${unknown ? `，不确定 ${unknown}` : ""}`;
}
