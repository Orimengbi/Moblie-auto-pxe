import type { RedfishDoc, RedfishRaw } from "./redfish.ts";
import type { BaselineIssue, BaselineRule, HwChange, HwComponent, HwKind, InventorySource } from "./types.ts";

/**
 * 整机硬件清单：系统里采集的脚本和解析、Redfish 文档到部件的转换、两次采集的比对、基准配置。
 * 这里只有纯函数，读写文件在 store.ts，执行在 remote.ts。
 */

export const KIND_LABEL: Record<HwKind, string> = {
  system: "整机",
  board: "主板",
  cpu: "CPU",
  memory: "内存",
  disk: "硬盘",
  gpu: "GPU",
  nic: "网卡",
  psu: "电源",
  firmware: "固件",
};

export const KIND_ORDER: HwKind[] = ["system", "board", "cpu", "memory", "gpu", "disk", "nic", "psu", "firmware"];

export const SOURCE_LABEL: Record<InventorySource, string> = {
  os: "系统内",
  bmc: "BMC",
};

/** 属性的中文名和单位，页面显示用。没列出的按原名显示。 */
export const ATTR_LABEL: Record<string, string> = {
  cores: "核数",
  threads: "线程",
  maxMHz: "最高频率 MHz",
  speedMHz: "当前频率 MHz",
  sizeGB: "容量 GB",
  type: "类型",
  speedMT: "速率 MT/s",
  configuredMT: "运行速率 MT/s",
  rank: "Rank",
  capacityGB: "容量 GB",
  media: "介质",
  transport: "接口",
  rpm: "转速",
  memoryMiB: "显存 MiB",
  driver: "驱动",
  powerLimitW: "功耗上限 W",
  index: "序号",
  uuid: "UUID",
  mac: "MAC",
  pci: "PCI",
  speedMbps: "速率 Mb/s",
  link: "链路",
  partNumber: "料号",
  capacityW: "功率 W",
  state: "状态",
  health: "健康",
  chassisSn: "机箱序列号",
  memorySlots: "内存槽",
  version: "版本",
  releaseDate: "日期",
};

/** 两次采集比对时看的属性。链路状态、驱动版本这类会随系统变的不算部件变化。 */
const STABLE_ATTRS: Partial<Record<HwKind, string[]>> = {
  cpu: ["cores", "threads"],
  memory: ["sizeGB", "type", "speedMT"],
  disk: ["capacityGB"],
  gpu: ["memoryMiB"],
  nic: ["mac", "partNumber"],
  psu: ["capacityW"],
};

/** 生成基准时一起分组的属性：同型号不同容量的内存、硬盘要分开数。 */
const GROUP_ATTRS: Partial<Record<HwKind, string[]>> = {
  memory: ["sizeGB"],
  disk: ["capacityGB"],
};

/**
 * 在目标机上以 root 执行，输出分段的原始文本，由 parseOsInventory 解析。
 * 工具没装就跳过那一段。只读，不改系统；只有没加载 IPMI 驱动时会 modprobe 一下以便读 BMC 版本。
 */
export const INVENTORY_SCRIPT = String.raw`export LC_ALL=C
export PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin"
sec() { printf '\n===PXEINV %s===\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
pci_of() { basename "$(readlink -f "$1/device")"; }
sec tools
for t in dmidecode lsblk smartctl nvidia-smi ethtool lspci ipmitool; do have "$t" || echo "missing $t"; done
sec dmidecode
have dmidecode && dmidecode -t 0,1,2,3,4,17 2>/dev/null
sec bmc
if have ipmitool; then
  [ -e /dev/ipmi0 ] || [ -e /dev/ipmi/0 ] || { timeout 20 modprobe ipmi_si 2>/dev/null; timeout 20 modprobe ipmi_devintf 2>/dev/null; }
  timeout 20 ipmitool mc info 2>/dev/null
fi
sec lsblk
have lsblk && lsblk -J -b -d -o NAME,TYPE,SIZE,MODEL,SERIAL,REV,TRAN,ROTA,VENDOR 2>/dev/null
sec smart
if have smartctl && have lsblk; then
  for d in $(lsblk -dn -o NAME,TYPE 2>/dev/null | awk '$2=="disk"{print $1}'); do
    echo "--- $d"
    timeout 30 smartctl -i -j "/dev/$d" 2>/dev/null
  done
fi
sec gpu
have nvidia-smi && timeout 60 nvidia-smi --query-gpu=index,name,serial,uuid,pci.bus_id,memory.total,vbios_version,driver_version,power.limit --format=csv,noheader,nounits 2>/dev/null
sec net
for n in /sys/class/net/*; do
  [ -e "$n/device" ] || continue
  i=$(basename "$n")
  echo "--- $i"
  echo "mac: $(cat "$n/address" 2>/dev/null)"
  echo "speed: $(cat "$n/speed" 2>/dev/null)"
  echo "state: $(cat "$n/operstate" 2>/dev/null)"
  echo "pci: $(pci_of "$n")"
  have ethtool && ethtool -i "$i" 2>/dev/null | grep -E '^(driver|firmware-version):'
done
sec vpd
if have lspci; then
  for bus in $(for n in /sys/class/net/*; do [ -e "$n/device" ] && pci_of "$n"; done | sort -u); do
    echo "--- $bus"
    lspci -s "$bus" 2>/dev/null | head -n 1
    lspci -vvv -s "$bus" 2>/dev/null | sed -n '/Vital Product Data/,/End$/p'
  done
fi
sec end
`;

const PLACEHOLDER =
  /^(not specified|unknown|not provided|to be filled by o\.e\.m\.?|default string|none|n\/a|na|null|not available|not applicable|not present|no module installed|example vpd|system serial number|system product name|base board serial number|chassis serial number|0x0*|0+|0123456789.*|01234567)$/i;

/** 去掉首尾空白和 BIOS、BMC 常见的占位文字。 */
export function clean(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  return PLACEHOLDER.test(trimmed) ? "" : trimmed;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : undefined;
}

/** 大于 0 才算读到了，BMC 常用 0 表示没有。 */
function positive(value: unknown): number | undefined {
  const n = num(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/** 只放有值的属性。读不到的数值传 undefined，不要传 0。 */
function attrs(pairs: Record<string, string | number | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(pairs)) {
    if (value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) continue;
    out[key] = value;
  }
  return out;
}

function component(kind: HwKind, slot: string, fields: Partial<Omit<HwComponent, "kind" | "slot">>): HwComponent {
  return {
    kind,
    slot,
    model: fields.model || "",
    vendor: fields.vendor || "",
    sn: fields.sn || "",
    firmware: fields.firmware || "",
    attrs: fields.attrs || {},
  };
}

/** "128 GB"、"16384 MB"、"2 TB" 换成 GB。 */
export function sizeToGb(text: string): number | undefined {
  const match = /^([\d.]+)\s*(kB|KB|MB|GB|TB)\b/i.exec(text.trim());
  if (!match) return undefined;
  const n = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const gb = unit === "TB" ? n * 1024 : unit === "GB" ? n : unit === "MB" ? n / 1024 : n / 1024 / 1024;
  return Math.round(gb * 100) / 100;
}

export function splitSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const re = /^===PXEINV (\S+)===$/gm;
  const marks = [...text.matchAll(re)];
  marks.forEach((mark, index) => {
    const start = (mark.index ?? 0) + mark[0].length + 1;
    const end = index + 1 < marks.length ? marks[index + 1].index ?? text.length : text.length;
    sections.set(mark[1], text.slice(start, end).replace(/\s+$/, ""));
  });
  return sections;
}

interface DmiBlock {
  type: number;
  title: string;
  fields: Record<string, string>;
}

export function parseDmidecode(text: string): DmiBlock[] {
  const blocks: DmiBlock[] = [];
  let current: DmiBlock | null = null;
  let wantTitle = false;
  for (const line of text.split("\n")) {
    const handle = /^Handle 0x[0-9A-Fa-f]+, DMI type (\d+)/.exec(line);
    if (handle) {
      current = { type: Number(handle[1]), title: "", fields: {} };
      blocks.push(current);
      wantTitle = true;
      continue;
    }
    if (!current) continue;
    if (wantTitle) {
      if (line.trim()) {
        current.title = line.trim();
        wantTitle = false;
      }
      continue;
    }
    if (!/^\t[^\t]/.test(line)) continue;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    if (!(key in current.fields)) current.fields[key] = line.slice(at + 1).trim();
  }
  return blocks;
}

/** "--- name" 分隔的小段。 */
function splitDashed(text: string): { name: string; body: string }[] {
  const out: { name: string; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const head = /^--- (.+)$/.exec(line);
    if (head) out.push({ name: head[1].trim(), lines: [] });
    else out.at(-1)?.lines.push(line);
  }
  return out.map((item) => ({ name: item.name, body: item.lines.join("\n") }));
}

function colonFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const at = line.indexOf(":");
    if (at < 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    if (key && !(key in fields)) fields[key] = line.slice(at + 1).trim();
  }
  return fields;
}

function jsonOrNull<T>(text: string | undefined): T | null {
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const PCI_ADDRESS = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/i;

/** 解析 INVENTORY_SCRIPT 的输出。 */
export function parseOsInventory(text: string): { components: HwComponent[]; warnings: string[] } {
  const sections = splitSections(text);
  const components: HwComponent[] = [];
  const warnings: string[] = [];
  if (!sections.has("end")) warnings.push("采集脚本没有跑完，结果可能不全");
  for (const line of (sections.get("tools") || "").split("\n")) {
    const missing = /^missing (\S+)/.exec(line.trim());
    if (missing) warnings.push(`系统里没有 ${missing[1]}`);
  }

  const dmi = parseDmidecode(sections.get("dmidecode") || "");
  const one = (type: number) => dmi.find((block) => block.type === type)?.fields || {};
  const memorySlots = dmi.filter((block) => block.type === 17);
  const system = one(1);
  if (Object.keys(system).length) {
    components.push(
      component("system", "整机", {
        model: clean(system["Product Name"]),
        vendor: clean(system.Manufacturer),
        sn: clean(system["Serial Number"]),
        attrs: attrs({ uuid: clean(system.UUID), chassisSn: clean(one(3)["Serial Number"]), memorySlots: memorySlots.length || undefined }),
      }),
    );
  }
  const board = one(2);
  if (Object.keys(board).length) {
    components.push(component("board", "主板", { model: clean(board["Product Name"]), vendor: clean(board.Manufacturer), sn: clean(board["Serial Number"]), attrs: attrs({ version: clean(board.Version) }) }));
  }
  const bios = one(0);
  if (clean(bios.Version)) {
    components.push(component("firmware", "BIOS", { model: "BIOS", vendor: clean(bios.Vendor), firmware: clean(bios.Version), attrs: attrs({ releaseDate: clean(bios["Release Date"]) }) }));
  }
  const bmc = colonFields(sections.get("bmc") || "");
  if (clean(bmc["firmware revision"])) {
    components.push(component("firmware", "BMC", { model: "BMC", firmware: clean(bmc["firmware revision"]) }));
  }

  for (const block of dmi.filter((item) => item.type === 4)) {
    if (!/populated/i.test(block.fields.Status || "") || /unpopulated/i.test(block.fields.Status || "")) continue;
    components.push(
      component("cpu", clean(block.fields["Socket Designation"]) || `CPU${components.filter((c) => c.kind === "cpu").length}`, {
        model: clean(block.fields.Version),
        vendor: clean(block.fields.Manufacturer),
        sn: clean(block.fields["Serial Number"]),
        attrs: attrs({
          cores: positive(block.fields["Core Count"]),
          threads: positive(block.fields["Thread Count"]),
          maxMHz: positive(block.fields["Max Speed"]),
          speedMHz: positive(block.fields["Current Speed"]),
        }),
      }),
    );
  }

  for (const block of memorySlots) {
    const size = sizeToGb(block.fields.Size || "");
    if (!size) continue;
    components.push(
      component("memory", clean(block.fields.Locator) || clean(block.fields["Bank Locator"]), {
        model: clean(block.fields["Part Number"]),
        vendor: clean(block.fields.Manufacturer),
        sn: clean(block.fields["Serial Number"]),
        attrs: attrs({
          sizeGB: size,
          type: clean(block.fields.Type),
          speedMT: positive(block.fields.Speed),
          configuredMT: positive(block.fields["Configured Memory Speed"] || block.fields["Configured Clock Speed"]),
          rank: positive(block.fields.Rank),
        }),
      }),
    );
  }

  const smart = new Map<string, Record<string, unknown>>();
  for (const item of splitDashed(sections.get("smart") || "")) {
    const parsed = jsonOrNull<Record<string, unknown>>(item.body);
    if (parsed) smart.set(item.name, parsed);
  }
  const lsblk = jsonOrNull<{ blockdevices?: Record<string, unknown>[] }>(sections.get("lsblk"));
  for (const dev of lsblk?.blockdevices || []) {
    const name = String(dev.name || "");
    const bytes = num(dev.size) || 0;
    if (dev.type !== "disk" || !bytes || /^(loop|ram|zram|md|dm-|nbd|sr|fd)/.test(name)) continue;
    const info = smart.get(name) || {};
    const model = clean(info.model_name) || clean(dev.model);
    if (dev.tran === "usb" && /virtual/i.test(model)) continue; // BMC 挂的虚拟 U 盘
    const nvme = dev.tran === "nvme" || name.startsWith("nvme");
    const rotational = dev.rota === true || dev.rota === "1" || (num(info.rotation_rate) || 0) > 0;
    components.push(
      component("disk", name, {
        model,
        vendor: clean(dev.vendor),
        sn: clean(info.serial_number) || clean(dev.serial),
        firmware: clean(info.firmware_version) || clean(dev.rev),
        attrs: attrs({
          capacityGB: Math.round(bytes / 1e9),
          media: nvme ? "NVMe SSD" : rotational ? "HDD" : "SSD",
          transport: clean(dev.tran),
          rpm: positive(info.rotation_rate),
        }),
      }),
    );
  }

  for (const line of (sections.get("gpu") || "").split("\n")) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length < 9 || !/^\d+$/.test(cells[0])) continue;
    const [index, name, serial, uuid, bus, memory, vbios, driver, power] = cells;
    components.push(
      component("gpu", bus.toLowerCase().replace(/^0000(?=[0-9a-f]{4}:)/, ""), {
        model: clean(name),
        vendor: "NVIDIA",
        sn: clean(serial),
        firmware: clean(vbios),
        attrs: attrs({ index: Number(index), uuid: clean(uuid), memoryMiB: positive(memory), driver: clean(driver), powerLimitW: positive(power) }),
      }),
    );
  }

  const vpd = new Map<string, { desc: string; fields: Record<string, string> }>();
  for (const item of splitDashed(sections.get("vpd") || "")) {
    const lines = item.body.split("\n");
    const desc = (lines[0] || "").replace(/^\S+\s+[^:]+:\s*/, "").replace(/\s*\(rev \w+\)$/, "").trim();
    const fields: Record<string, string> = {};
    for (const line of lines.slice(1)) {
      const product = /^\s*Product Name:\s*(.*)$/.exec(line);
      if (product) fields.product = product[1];
      const tagged = /^\s*\[(\w\w)\][^:]*:\s*(.*)$/.exec(line);
      if (tagged && !(tagged[1] in fields)) fields[tagged[1]] = tagged[2];
    }
    vpd.set(item.name, { desc, fields });
  }
  for (const item of splitDashed(sections.get("net") || "")) {
    const fields = colonFields(item.body);
    const pci = fields.pci || "";
    if (!PCI_ADDRESS.test(pci)) continue; // USB 网卡（比如 BMC 的虚拟网口）不算
    const card = vpd.get(pci);
    components.push(
      component("nic", item.name, {
        model: clean(card?.fields.product) || clean(card?.desc),
        sn: clean(card?.fields.SN),
        firmware: clean(fields["firmware-version"]),
        attrs: attrs({
          mac: clean(fields.mac),
          pci,
          driver: clean(fields.driver),
          speedMbps: positive(fields.speed),
          link: clean(fields.state),
          partNumber: clean(card?.fields.PN),
        }),
      }),
    );
  }

  return { components, warnings };
}

function rfStr(doc: RedfishDoc | undefined, key: string): string {
  return clean(doc?.[key]);
}

function rfId(doc: RedfishDoc): string {
  return clean(doc.Id) || String(doc["@odata.id"] || "").split("/").filter(Boolean).pop() || "";
}

function rfState(doc: RedfishDoc): string {
  return clean((doc.Status as { State?: string } | undefined)?.State);
}

/** 把 crawlRedfish 读到的文档换成部件列表。 */
export function redfishComponents(raw: RedfishRaw): HwComponent[] {
  const components: HwComponent[] = [];
  const gpus = raw.processors.filter((doc) => rfStr(doc, "ProcessorType") === "GPU" && rfState(doc) !== "Absent");
  const gpuIds = gpus.map(rfId);
  const isGpuMemory = (doc: RedfishDoc) => rfStr(doc, "MemoryDeviceType") === "HBM" || gpuIds.some((id) => rfId(doc).startsWith(`${id}_`));
  const dimms = raw.memory.filter((doc) => !isGpuMemory(doc));

  for (const system of raw.systems.filter((doc) => rfStr(doc, "SerialNumber"))) {
    const base = String(system["@odata.id"] || "");
    components.push(
      component("system", "整机", {
        model: rfStr(system, "Model"),
        vendor: rfStr(system, "Manufacturer"),
        sn: rfStr(system, "SerialNumber"),
        attrs: attrs({ uuid: rfStr(system, "UUID"), memorySlots: dimms.filter((doc) => String(doc["@odata.id"] || "").startsWith(`${base}/`)).length || undefined }),
      }),
    );
  }

  for (const doc of raw.processors) {
    const type = rfStr(doc, "ProcessorType");
    if (rfState(doc) === "Absent" || (type && type !== "CPU") || (!type && !doc.TotalCores)) continue;
    components.push(
      component("cpu", rfStr(doc, "Socket") || rfId(doc), {
        model: rfStr(doc, "Model"),
        vendor: rfStr(doc, "Manufacturer"),
        sn: rfStr(doc, "SerialNumber"),
        attrs: attrs({ cores: positive(doc.TotalCores), threads: positive(doc.TotalThreads), maxMHz: positive(doc.MaxSpeedMHz) }),
      }),
    );
  }

  for (const doc of dimms) {
    const mib = num(doc.CapacityMiB) || 0;
    if (rfState(doc) === "Absent" || mib <= 0) continue;
    components.push(
      component("memory", rfStr(doc, "DeviceLocator") || rfId(doc), {
        model: rfStr(doc, "PartNumber"),
        vendor: rfStr(doc, "Manufacturer"),
        sn: rfStr(doc, "SerialNumber"),
        attrs: attrs({ sizeGB: Math.round((mib / 1024) * 100) / 100, type: rfStr(doc, "MemoryDeviceType"), speedMT: positive(doc.OperatingSpeedMhz), rank: positive(doc.RankCount) }),
      }),
    );
  }

  for (const doc of gpus) {
    const id = rfId(doc);
    const memory = raw.memory.filter((item) => rfId(item).startsWith(`${id}_`)).reduce((sum, item) => sum + (num(item.CapacityMiB) || 0), 0);
    components.push(
      component("gpu", id, {
        model: rfStr(doc, "Model"),
        vendor: rfStr(doc, "Manufacturer"),
        sn: rfStr(doc, "SerialNumber"),
        firmware: rfStr(doc, "FirmwareVersion"),
        attrs: attrs({ partNumber: rfStr(doc, "PartNumber"), memoryMiB: memory || undefined, maxMHz: positive(doc.MaxSpeedMHz) }),
      }),
    );
  }

  for (const doc of raw.drives) {
    if (rfState(doc) === "Absent") continue;
    const bytes = num(doc.CapacityBytes) || 0;
    components.push(
      component("disk", rfId(doc), {
        model: rfStr(doc, "Model"),
        vendor: rfStr(doc, "Manufacturer"),
        sn: rfStr(doc, "SerialNumber"),
        firmware: rfStr(doc, "FirmwareVersion") || rfStr(doc, "Revision"),
        attrs: attrs({ capacityGB: bytes ? Math.round(bytes / 1e9) : undefined, media: rfStr(doc, "MediaType"), transport: rfStr(doc, "Protocol") }),
      }),
    );
  }

  for (const doc of raw.networkAdapters) {
    const id = rfId(doc);
    const name = rfStr(doc, "Name");
    const model = rfStr(doc, "Model") || (name !== id ? name : "");
    const sn = rfStr(doc, "SerialNumber");
    // 有的 BMC（如 NVIDIA HGX 底板）把同一块卡再列一遍，只有编号没有型号，跳过。
    if (!model && !sn) continue;
    const controllers = Array.isArray(doc.Controllers) ? (doc.Controllers as RedfishDoc[]) : [];
    components.push(
      component("nic", id, {
        model,
        vendor: rfStr(doc, "Manufacturer"),
        sn,
        firmware: rfStr(controllers[0], "FirmwarePackageVersion"),
        attrs: attrs({ partNumber: rfStr(doc, "PartNumber") }),
      }),
    );
  }

  for (const doc of raw.powerSupplies) {
    // NVIDIA HGX 底板把板上的热插拔控制器也列成 PowerSupplies，不是整机电源。
    if (String(doc["@odata.id"] || "").includes("/HGX_")) continue;
    if (rfState(doc) === "Absent") continue;
    const status = doc.Status as { Health?: string } | undefined;
    components.push(
      component("psu", rfStr(doc, "Name") || rfStr(doc, "MemberId") || rfId(doc), {
        model: rfStr(doc, "Model"),
        vendor: rfStr(doc, "Manufacturer"),
        sn: rfStr(doc, "SerialNumber"),
        firmware: rfStr(doc, "FirmwareVersion"),
        attrs: attrs({ capacityW: positive(doc.PowerCapacityWatts), state: rfState(doc), health: clean(status?.Health), partNumber: rfStr(doc, "PartNumber") }),
      }),
    );
  }

  if (raw.firmware.length) {
    for (const doc of raw.firmware) {
      const version = rfStr(doc, "Version");
      if (!version) continue;
      const id = rfId(doc);
      const name = rfStr(doc, "Name");
      const label = name && name !== "Software Inventory" ? name : id;
      components.push(component("firmware", id, { model: label, vendor: rfStr(doc, "Manufacturer"), firmware: version }));
    }
  } else {
    const system = raw.systems.find((doc) => rfStr(doc, "BiosVersion"));
    if (system) components.push(component("firmware", "BIOS", { model: "BIOS", firmware: rfStr(system, "BiosVersion") }));
    for (const manager of raw.managers.filter((doc) => rfStr(doc, "ManagerType") === "BMC" && rfStr(doc, "FirmwareVersion"))) {
      components.push(component("firmware", rfId(manager), { model: `BMC ${rfId(manager)}`, firmware: rfStr(manager, "FirmwareVersion") }));
    }
  }
  return components;
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 同一个部件前后两次在哪些字段上不一样。槽位变了不算（盘符、网口名会因为系统变化重排）。 */
function changedFields(before: HwComponent, after: HwComponent): string[] {
  const fields: string[] = [];
  if (norm(before.model) !== norm(after.model)) fields.push("model");
  if (before.firmware !== after.firmware) fields.push("firmware");
  for (const key of STABLE_ATTRS[after.kind] || []) {
    if (String(before.attrs[key] ?? "") !== String(after.attrs[key] ?? "")) fields.push(key);
  }
  return fields;
}

/**
 * 比较同一来源的两次采集。先按「类别+槽位+序列号」配对，再按序列号（盘符换了），
 * 最后按槽位（同一个位置换了部件，算 replaced）；剩下的是新增或拆掉的。
 */
export function diffComponents(before: HwComponent[], after: HwComponent[]): HwChange[] {
  const left = [...before];
  const right = [...after];
  const pairs: [HwComponent, HwComponent][] = [];
  const take = (match: (a: HwComponent, b: HwComponent) => boolean) => {
    for (let i = 0; i < right.length; ) {
      const j = left.findIndex((a) => match(a, right[i]));
      if (j < 0) {
        i++;
        continue;
      }
      pairs.push([left[j], right[i]]);
      left.splice(j, 1);
      right.splice(i, 1);
    }
  };
  take((a, b) => a.kind === b.kind && a.slot === b.slot && a.sn === b.sn);
  take((a, b) => a.kind === b.kind && Boolean(b.sn) && a.sn === b.sn);
  take((a, b) => a.kind === b.kind && a.slot === b.slot);

  const changes: HwChange[] = [];
  for (const [a, b] of pairs) {
    if (a.sn && b.sn && a.sn !== b.sn) {
      changes.push({ type: "replaced", kind: b.kind, slot: b.slot, before: a, after: b });
      continue;
    }
    const fields = changedFields(a, b);
    if (fields.length) changes.push({ type: "changed", kind: b.kind, slot: b.slot, before: a, after: b, fields });
  }
  for (const a of left) changes.push({ type: "removed", kind: a.kind, slot: a.slot, before: a });
  for (const b of right) changes.push({ type: "added", kind: b.kind, slot: b.slot, after: b });
  return changes.sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.slot.localeCompare(y.slot, "en", { numeric: true }));
}

function groupKey(item: HwComponent): string {
  const extra = (GROUP_ATTRS[item.kind] || []).map((key) => String(item.attrs[key] ?? ""));
  return [item.kind, norm(item.model), ...extra].join("\u0000");
}

/** 从一台好机器的采集生成基准：按类别、型号（内存和硬盘再加容量）数个数；同组过半一致的固件版本记为要求。 */
export function generateBaseline(components: HwComponent[]): BaselineRule[] {
  const groups = new Map<string, HwComponent[]>();
  for (const item of components) {
    const key = groupKey(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const rules: BaselineRule[] = [];
  for (const items of groups.values()) {
    const first = items[0];
    const rule: BaselineRule = { kind: first.kind, model: first.model, count: items.length };
    const versions = new Map<string, number>();
    for (const item of items) if (item.firmware) versions.set(item.firmware, (versions.get(item.firmware) || 0) + 1);
    const [top] = [...versions.entries()].sort((a, b) => b[1] - a[1]);
    if (top && top[1] * 2 > items.length) rule.firmware = top[0];
    const keys = GROUP_ATTRS[first.kind] || [];
    if (keys.length) rule.attrs = Object.fromEntries(keys.filter((key) => first.attrs[key] !== undefined).map((key) => [key, String(first.attrs[key])]));
    rules.push(rule);
  }
  return rules.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.model.localeCompare(b.model, "en", { numeric: true }));
}

function ruleMatches(rule: BaselineRule, item: HwComponent): boolean {
  if (item.kind !== rule.kind || norm(item.model) !== norm(rule.model)) return false;
  return Object.entries(rule.attrs || {}).every(([key, value]) => String(item.attrs[key] ?? "") === String(value));
}

export function ruleLabel(rule: Pick<BaselineRule, "kind" | "model" | "attrs">): string {
  const extra = Object.entries(rule.attrs || {}).map(([key, value]) => `${ATTR_LABEL[key] || key} ${value}`);
  return [KIND_LABEL[rule.kind], rule.model || "（无型号）", ...extra].join(" ");
}

/** 按基准检查一台机器。没问题返回空数组。基准里没有的类别不检查。 */
export function checkBaseline(rules: BaselineRule[], components: HwComponent[]): BaselineIssue[] {
  const issues: BaselineIssue[] = [];
  const used = new Set<HwComponent>();
  for (const rule of rules) {
    const matched = components.filter((item) => !used.has(item) && ruleMatches(rule, item));
    matched.forEach((item) => used.add(item));
    if (matched.length !== rule.count) {
      const diff = matched.length - rule.count;
      issues.push({ kind: rule.kind, model: rule.model, message: `${ruleLabel(rule)}：应有 ${rule.count} 个，实有 ${matched.length} 个（${diff > 0 ? "多" : "少"} ${Math.abs(diff)} 个）` });
    }
    if (rule.firmware) {
      const bad = matched.filter((item) => item.firmware !== rule.firmware);
      if (bad.length) {
        issues.push({
          kind: rule.kind,
          model: rule.model,
          message: `${ruleLabel(rule)}：固件应为 ${rule.firmware}，${bad.map((item) => `${item.slot} 是 ${item.firmware || "（读不到）"}`).join("，")}`,
        });
      }
    }
  }
  const checked = new Set(rules.map((rule) => rule.kind));
  const extra = new Map<string, { item: HwComponent; count: number }>();
  for (const item of components) {
    if (used.has(item) || !checked.has(item.kind)) continue;
    const key = groupKey(item);
    const entry = extra.get(key);
    if (entry) entry.count++;
    else extra.set(key, { item, count: 1 });
  }
  for (const { item, count } of extra.values()) {
    const keys = GROUP_ATTRS[item.kind] || [];
    const label = ruleLabel({ kind: item.kind, model: item.model, attrs: Object.fromEntries(keys.map((key) => [key, String(item.attrs[key] ?? "")])) });
    issues.push({ kind: item.kind, model: item.model, message: `${label}：基准里没有，实有 ${count} 个` });
  }
  return issues;
}

/** 任务输出里的一段摘要，每类一行。 */
export function summarizeComponents(components: HwComponent[]): string[] {
  const lines: string[] = [];
  for (const kind of KIND_ORDER) {
    const items = components.filter((item) => item.kind === kind);
    if (!items.length) continue;
    if (kind === "system" || kind === "board") {
      lines.push(`${KIND_LABEL[kind]} ${items.map((item) => [item.vendor, item.model, item.sn && `SN ${item.sn}`].filter(Boolean).join(" ")).join("；")}`);
      continue;
    }
    if (kind === "firmware") {
      lines.push(`固件 ${items.length} 项`);
      continue;
    }
    const counts = new Map<string, number>();
    for (const item of items) {
      const size = kind === "memory" ? ` ${item.attrs.sizeGB}GB` : kind === "disk" ? ` ${item.attrs.capacityGB}GB` : "";
      const label = `${item.model || "（无型号）"}${size}`;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    let line = `${KIND_LABEL[kind]} ${[...counts.entries()].map(([label, n]) => `${n} × ${label}`).join("，")}`;
    if (kind === "memory") {
      const total = items.reduce((sum, item) => sum + (Number(item.attrs.sizeGB) || 0), 0);
      const slots = components.find((item) => item.kind === "system")?.attrs.memorySlots;
      line += `，共 ${Math.round(total)} GB${slots ? `（${items.length}/${slots} 槽）` : ""}`;
    }
    lines.push(line);
  }
  return lines;
}

export const CHANGE_LABEL: Record<HwChange["type"], string> = {
  added: "新增",
  removed: "拆除",
  replaced: "更换",
  changed: "变化",
};

/** 变化的内容，不带「新增」「更换」这类开头。 */
export function changeDetail(change: HwChange): string {
  const head = `${KIND_LABEL[change.kind]} ${change.slot}`;
  const part = (item?: HwComponent) => (item ? [item.model, item.sn && `SN ${item.sn}`].filter(Boolean).join(" ") : "");
  if (change.type === "added") return `${head}：${part(change.after)}`;
  if (change.type === "removed") return `${head}：${part(change.before)}`;
  if (change.type === "replaced") return `${head}：${part(change.before)} → ${part(change.after)}`;
  const value = (item: HwComponent | undefined, field: string) =>
    String(field === "model" ? item?.model : field === "firmware" ? item?.firmware : item?.attrs[field] ?? "") || "（空）";
  return `${head}：${(change.fields || []).map((field) => `${field === "model" ? "型号" : field === "firmware" ? "固件" : ATTR_LABEL[field] || field} ${value(change.before, field)} → ${value(change.after, field)}`).join("，")}`;
}

export function describeChange(change: HwChange): string {
  return `${CHANGE_LABEL[change.type]} ${changeDetail(change)}`;
}
