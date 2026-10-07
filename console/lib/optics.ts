import type { HwComponent, OpticsPort } from "./types.ts";

/**
 * 光模块：型号、序列号和收发光强度。NVIDIA/Mellanox 的网卡用 mlxlink 读（CMIS 的 OSFP/QSFP-DD 也能解），
 * 其他网卡用 ethtool -m。只读，不改模块和链路。
 */

/** 每个口输出一段，段头是 "===PXEOPT mlx <rdma> <pci> <网口...>===" 或 "===PXEOPT eth <网口> <pci>==="。 */
export const OPTICS_BODY = String.raw`pxeopt_pci() { basename "$(readlink -f "$1/device")"; }
if command -v mlxlink >/dev/null 2>&1; then
  for d in /sys/class/infiniband/*; do
    [ -e "$d/device" ] || continue
    echo "===PXEOPT mlx $(basename "$d") $(pxeopt_pci "$d") $(ls "$d/device/net" 2>/dev/null | tr '\n' ' ')==="
    timeout 30 mlxlink -d "$(basename "$d")" -m --json 2>&1
  done
fi
for n in /sys/class/net/*; do
  [ -e "$n/device" ] || continue
  if command -v mlxlink >/dev/null 2>&1 && [ -d "$n/device/infiniband" ]; then continue; fi
  case "$(pxeopt_pci "$n")" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f]:*) ;; *) continue ;; esac
  echo "===PXEOPT eth $(basename "$n") $(pxeopt_pci "$n")==="
  timeout 20 ethtool -m "$(basename "$n")" 2>&1 | head -n 300
done
echo "===PXEOPT end==="
`;

/** 单独查收发光时在目标机上执行的脚本。 */
export const OPTICS_SCRIPT = `export LC_ALL=C
export PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin"
${OPTICS_BODY}`;

const PLACEHOLDER = /^(n\/a|na|unknown|none|0+|)$/i;

function text(value: unknown): string {
  const trimmed = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" ? String(value) : "";
  return PLACEHOLDER.test(trimmed) ? "" : trimmed;
}

/** "0,2,0,0 [-8..6]" → 每条 lane 的值和门限。 */
export function parseLaneValues(raw: unknown): { values: number[]; range?: [number, number] } {
  const value = typeof raw === "string" ? raw : "";
  const range = /\[\s*(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)\s*\]/.exec(value);
  const values = value
    .replace(/\[.*\]/, "")
    .split(",")
    .map((item) => parseFloat(item))
    .filter((n) => Number.isFinite(n));
  return { values, ...(range ? { range: [Number(range[1]), Number(range[2])] as [number, number] } : {}) };
}

function firstNumber(raw: unknown): number | undefined {
  const n = parseFloat(typeof raw === "string" ? raw : String(raw ?? ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseMlxlink(head: string[], body: string): OpticsPort {
  const [, rdma, pci, ...nets] = head;
  const port: OpticsPort = { port: nets[0] || rdma, ports: nets, rdma, pci, source: "mlxlink", present: false, rx: [], tx: [] };
  const start = body.indexOf("{");
  let parsed: { status?: { code?: number; message?: string }; result?: { output?: Record<string, Record<string, unknown>> } } | null = null;
  try {
    parsed = start >= 0 ? JSON.parse(body.slice(start)) : null;
  } catch {
    parsed = null;
  }
  const info = parsed?.result?.output?.["Module Info"];
  if (!info) {
    // eslint-disable-next-line no-control-regex
    const message = body.replace(/\u001b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim().replace(/^-E-\s*/, "");
    port.error = parsed?.status?.message && parsed.status.code !== 0 ? parsed.status.message : message.slice(0, 200) || "mlxlink 没有返回模块信息";
    return port;
  }
  port.type = text(info.Identifier);
  port.vendor = text(info["Vendor Name"]);
  port.model = text(info["Vendor Part Number"]);
  port.sn = text(info["Vendor Serial Number"]);
  port.firmware = text(info["FW Version"]);
  port.compliance = text(info["Active Set Media Compliance Code"]) || text(String(info.Compliance || "").replace(/^,+/, ""));
  port.cable = text(info["Cable Type"]);
  port.wavelengthNm = firstNumber(info["Wavelength [nm]"]);
  port.length = text(info["SMF Length"]) || text(info["OM3 Length"]) || text(info["Cable Length"]);
  const temp = parseLaneValues(info["Temperature [C]"]);
  port.temperatureC = temp.values[0];
  if (temp.range) port.temperatureRange = temp.range;
  port.voltageV = firstNumber(info["Voltage [mV]"]) !== undefined ? Math.round((firstNumber(info["Voltage [mV]"])! / 1000) * 1000) / 1000 : undefined;
  const rx = parseLaneValues(info["Rx Power Current [dBm]"]);
  const tx = parseLaneValues(info["Tx Power Current [dBm]"]);
  port.rx = rx.values;
  port.tx = tx.values;
  if (rx.range) port.rxRange = rx.range;
  if (tx.range) port.txRange = tx.range;
  port.present = Boolean(port.model || port.sn || port.type);
  if (!port.present) port.error = "没有插模块";
  return port;
}

/** ethtool -m 的 "Rx power channel 1 : 0.6553 mW / -1.84 dBm" 这类行。 */
function dbm(value: string): number | undefined {
  const match = /(-?[\d.]+|-inf)\s*dBm/i.exec(value);
  if (!match) return undefined;
  return match[1].toLowerCase() === "-inf" ? -40 : Number(match[1]);
}

function parseEthtool(head: string[], body: string): OpticsPort {
  const [, name, pci] = head;
  const port: OpticsPort = { port: name, ports: [name], pci, source: "ethtool", present: false, rx: [], tx: [] };
  const fields: [string, string][] = [];
  for (const line of body.split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields.push([line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()]);
  }
  const get = (key: string) => fields.find(([k]) => k === key)?.[1] || "";
  if (!fields.some(([key]) => key === "identifier")) {
    const message = body.replace(/\s+/g, " ").trim();
    port.error = /^Offset\b/.test(message) ? "ethtool 解不了这种模块（版本太旧），只拿到原始数据" : message.slice(0, 200) || "读不到模块";
    return port;
  }
  port.type = get("identifier").replace(/^0x[0-9a-f]+\s*\((.*)\)$/i, "$1");
  port.vendor = text(get("vendor name"));
  port.model = text(get("vendor pn"));
  port.sn = text(get("vendor sn"));
  port.firmware = text(get("vendor rev"));
  port.compliance = text(get("transceiver type")).replace(/^[^:]*:\s*/, "");
  port.cable = text(get("connector")).replace(/^0x[0-9a-f]+\s*\((.*)\)$/i, "$1");
  port.wavelengthNm = firstNumber(get("laser wavelength"));
  port.temperatureC = firstNumber(get("module temperature"));
  port.voltageV = firstNumber(get("module voltage"));
  for (const [key, value] of fields) {
    if (/threshold/.test(key)) continue;
    const power = dbm(value);
    if (power === undefined) continue;
    if (/^(rx power|receiver signal|rcvr signal)/.test(key)) port.rx.push(power);
    else if (/^(transmit avg optical power|laser output power|tx power)/.test(key)) port.tx.push(power);
  }
  const threshold = (kind: string, edge: string) => dbm(fields.find(([key]) => key.includes(kind) && key.includes(`${edge} alarm threshold`))?.[1] || "");
  const rxLow = threshold("rx power", "low");
  const rxHigh = threshold("rx power", "high");
  const txLow = threshold("output power", "low") ?? threshold("tx power", "low");
  const txHigh = threshold("output power", "high") ?? threshold("tx power", "high");
  if (rxLow !== undefined && rxHigh !== undefined) port.rxRange = [rxLow, rxHigh];
  if (txLow !== undefined && txHigh !== undefined) port.txRange = [txLow, txHigh];
  port.present = Boolean(port.model || port.sn);
  if (!port.present) port.error = "没有插模块";
  return port;
}

/** 解析 OPTICS_BODY 的输出。 */
export function parseOptics(text: string): OpticsPort[] {
  const ports: OpticsPort[] = [];
  const marks = [...text.matchAll(/^===PXEOPT (.+)===$/gm)];
  marks.forEach((mark, index) => {
    const head = mark[1].trim().split(/\s+/);
    if (head[0] === "end") return;
    const start = (mark.index ?? 0) + mark[0].length + 1;
    const end = index + 1 < marks.length ? marks[index + 1].index ?? text.length : text.length;
    const body = text.slice(start, end);
    if (head[0] === "mlx" && head.length >= 3) ports.push(parseMlxlink(head, body));
    else if (head[0] === "eth" && head.length >= 3) ports.push(parseEthtool(head, body));
  });
  // 没插模块的电口（比如板载万兆电口）不列出来；读错了的照样列，方便发现问题。
  return ports.filter((port) => port.present || (port.source === "mlxlink" && port.error !== "没有插模块") || port.error?.startsWith("ethtool 解不了"));
}

/** 插着的光模块换成部件，进硬件清单。 */
export function opticsComponents(ports: OpticsPort[]): HwComponent[] {
  return ports
    .filter((port) => port.present)
    .map((port) => ({
      kind: "transceiver" as const,
      slot: port.port,
      model: port.model || "",
      vendor: port.vendor || "",
      sn: port.sn || "",
      firmware: port.firmware || "",
      attrs: Object.fromEntries(
        Object.entries({
          type: port.type,
          compliance: port.compliance,
          wavelengthNm: port.wavelengthNm,
          length: port.length,
          cable: port.cable,
          rdma: port.rdma,
        }).filter(([, value]) => value !== undefined && value !== ""),
      ) as Record<string, string | number>,
    }));
}

/** 一个读数相对门限的状态：超出门限 bad，离下限不到 2 dB warn。 */
export function powerLevel(value: number, range?: [number, number]): "ok" | "warn" | "bad" {
  if (!range) return "ok";
  if (value < range[0] || value > range[1]) return "bad";
  if (value < range[0] + 2) return "warn";
  return "ok";
}
