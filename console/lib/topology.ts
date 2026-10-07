import type { HwComponent, Topology, TopoDevice } from "./types.ts";

/**
 * GPU 和网卡的拓扑：从 sysfs 读到的 PCIe 上游路径算出两两之间隔了什么（和 nvidia-smi topo -m 一样的叫法），
 * GPU 之间的 NVLink 条数取自 nvidia-smi topo -m。纯函数，采集脚本的输出由 inventory.ts 分段后交给这里。
 */

export type LinkType = "X" | "NV" | "PIX" | "PXB" | "PHB" | "NODE" | "SYS";

export const LINK_LABEL: Record<Exclude<LinkType, "X">, string> = {
  NV: "NVLink 直连",
  PIX: "最多经过一个 PCIe 桥（同一张卡或同一个交换口）",
  PXB: "经过多个 PCIe 桥，不经过 CPU（同一个 PCIe 交换芯片）",
  PHB: "经过 CPU 的 PCIe 主桥（同一个根复合体）",
  NODE: "同一个 NUMA 节点里的不同根复合体",
  SYS: "跨 NUMA 节点，要经过 CPU 之间的互联",
};

/** 一行 "0000:06:00.0 0x030200 0x10de 0 /sys/devices/pci0000:00/0000:00:01.1/.../0000:06:00.0"。 */
function parsePciLine(line: string): { pci: string; cls: string; vendor: string; numa: number | null; root: string; bridges: string[] } | null {
  const [pci, cls, vendor, numa, real] = line.trim().split(/\s+/);
  if (!pci || !real?.startsWith("/sys/devices/")) return null;
  const parts = real.slice("/sys/devices/".length).split("/");
  const root = parts[0];
  if (!/^pci[0-9a-f]{4}:[0-9a-f]{2}$/i.test(root) || parts.at(-1) !== pci) return null;
  const node = Number(numa);
  return { pci, cls, vendor, numa: Number.isInteger(node) && node >= 0 ? node : null, root, bridges: parts.slice(1, -1) };
}

/** 去掉 nvidia-smi 表头里的终端颜色码。 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/** 从 nvidia-smi topo -m 里读出 GPU 之间的 NVLink 条数，按 GPU 序号。 */
export function parseNvlinks(text: string): { a: number; b: number; count: number }[] {
  const lines = stripAnsi(text).split("\n");
  const header = lines.find((line) => /^\s*GPU0\b/.test(line) && !/^GPU0\s+X\b/.test(line.trim()));
  if (!header) return [];
  const columns = header.trim().split(/\t+/).map((cell) => cell.trim());
  const links: { a: number; b: number; count: number }[] = [];
  for (const line of lines) {
    const row = /^GPU(\d+)\t/.exec(line);
    if (!row) continue;
    const cells = line.split("\t").slice(1).map((cell) => cell.trim());
    cells.forEach((cell, i) => {
      const col = /^GPU(\d+)$/.exec(columns[i] || "");
      const nv = /^NV(\d+)$/.exec(cell);
      if (!col || !nv) return;
      const a = Number(row[1]);
      const b = Number(col[1]);
      if (a < b) links.push({ a, b, count: Number(nv[1]) });
    });
  }
  return links;
}

/** "NUMA node0 CPU(s):   0-63" → { "0": "0-63" } */
function parseNumaCpus(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^NUMA node(\d+) CPU\(s\):\s*(\S.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

/**
 * 把采集脚本的 pcitopo、rdma、gputopo、numa 几段和已经解析好的部件拼成拓扑。
 * 只收 GPU（NVIDIA 的 3D/VGA 控制器）和网卡（以太网、InfiniBand）。一块也没有就返回 undefined。
 */
export function buildTopology(sections: Map<string, string>, components: HwComponent[]): Topology | undefined {
  const rdma = new Map<string, string[]>();
  for (const line of (sections.get("rdma") || "").split("\n")) {
    const [name, pci] = line.trim().split(/\s+/);
    if (name && pci) rdma.set(pci, [...(rdma.get(pci) || []), name]);
  }
  const gpus = components.filter((item) => item.kind === "gpu");
  const nics = components.filter((item) => item.kind === "nic");
  const devices: TopoDevice[] = [];
  for (const line of (sections.get("pcitopo") || "").split("\n")) {
    const entry = parsePciLine(line);
    if (!entry) continue;
    const isGpu = (entry.cls.startsWith("0x0302") || entry.cls.startsWith("0x0300")) && entry.vendor === "0x10de";
    const isNic = entry.cls.startsWith("0x02");
    if (!isGpu && !isNic) continue;
    const short = entry.pci.toLowerCase();
    if (isGpu) {
      const gpu = gpus.find((item) => item.slot.toLowerCase() === short);
      devices.push({
        pci: entry.pci,
        kind: "gpu",
        name: gpu?.attrs.index !== undefined ? `GPU${gpu.attrs.index}` : `GPU ${entry.pci.slice(5)}`,
        model: gpu?.model || "",
        sn: gpu?.sn || "",
        numa: entry.numa,
        root: entry.root,
        bridges: entry.bridges,
        netdevs: [],
        rdma: [],
      });
    } else {
      const ports = nics.filter((item) => String(item.attrs.pci || "").toLowerCase() === short);
      devices.push({
        pci: entry.pci,
        kind: "nic",
        name: ports.map((item) => item.slot).join(", ") || rdma.get(entry.pci)?.join(", ") || entry.pci.slice(5),
        model: ports[0]?.model || "",
        sn: ports[0]?.sn || "",
        numa: entry.numa,
        root: entry.root,
        bridges: entry.bridges,
        netdevs: ports.map((item) => item.slot),
        rdma: rdma.get(entry.pci) || [],
      });
    }
  }
  if (!devices.length) return undefined;
  const byIndex = new Map(gpus.map((item) => [Number(item.attrs.index), item.slot.toLowerCase()]));
  const nvlinks = parseNvlinks(sections.get("gputopo") || "")
    .map((link) => ({ a: byIndex.get(link.a) || "", b: byIndex.get(link.b) || "", count: link.count }))
    .filter((link) => link.a && link.b)
    .map((link) => ({ a: devices.find((d) => d.pci.toLowerCase() === link.a)?.pci || link.a, b: devices.find((d) => d.pci.toLowerCase() === link.b)?.pci || link.b, count: link.count }));
  devices.sort((x, y) => (x.kind === y.kind ? x.pci.localeCompare(y.pci) : x.kind === "gpu" ? -1 : 1));
  return { devices, nvlinks, numaCpus: parseNumaCpus(sections.get("numa") || "") };
}

/** 两个设备之间隔了什么。NVLink 优先；其余按 PCIe 路径算，和 nvidia-smi topo -m 的定义一致。 */
export function linkBetween(topology: Topology, a: TopoDevice, b: TopoDevice): { type: LinkType; count?: number } {
  if (a.pci === b.pci) return { type: "X" };
  const nv = topology.nvlinks.find((link) => (link.a === a.pci && link.b === b.pci) || (link.a === b.pci && link.b === a.pci));
  if (nv) return { type: "NV", count: nv.count };
  if (a.root !== b.root) return { type: a.numa !== null && a.numa === b.numa ? "NODE" : "SYS" };
  let common = 0;
  while (common < a.bridges.length && common < b.bridges.length && a.bridges[common] === b.bridges[common]) common++;
  if (common === 0) return { type: "PHB" };
  // 两边各自到共同的桥要经过的桥，加上共同的那一个。
  const traversed = a.bridges.length - common + (b.bridges.length - common) + 1;
  return { type: traversed <= 1 ? "PIX" : "PXB" };
}

export function linkText(link: { type: LinkType; count?: number }): string {
  return link.type === "NV" ? `NV${link.count ?? ""}` : link.type;
}

/** 一张网卡的几个口（同一个 bus:device 的不同 function）算一张卡。 */
export function cardKey(device: TopoDevice): string {
  return device.pci.replace(/\.[0-7]$/, "");
}
