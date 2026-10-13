import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { runProcess } from "./process.ts";
import type { FirmwareChecksum, FirmwareComponent, FirmwareImage, FirmwareKind, VersionRelation } from "./firmware-types.ts";

/**
 * 认固件包：解开 zip / tar，读发布说明（PDF、txt）、看镜像文件头（技嘉 RBU、NVIDIA PLDM fwpkg），
 * 推出是哪家的什么固件、几版、适用哪些型号、怎么刷，再按发布说明里的校验和核对镜像有没有坏。
 */

const MAX_ENTRIES = 5000;
const MAX_UNPACKED = 6 * 1024 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  const read = fs.readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, read);
}

export function isZip(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    return readAt(fd, 0, 4).readUInt32LE(0) === 0x04034b50;
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

/** 读 zip 的中央目录，支持 zip64。 */
export function zipEntries(file: string): ZipEntry[] {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tailLength = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLength, tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        eocd = index;
        break;
      }
    }
    if (eocd < 0) throw new Error("zip 文件不完整（找不到目录）");
    let count = tail.readUInt16LE(eocd + 10);
    let directorySize = tail.readUInt32LE(eocd + 12);
    let directoryOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      const locator = eocd - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50) throw new Error("zip64 目录找不到");
      const record = readAt(fd, Number(tail.readBigUInt64LE(locator + 8)), 56);
      if (record.readUInt32LE(0) !== 0x06064b50) throw new Error("zip64 目录损坏");
      count = Number(record.readBigUInt64LE(32));
      directorySize = Number(record.readBigUInt64LE(40));
      directoryOffset = Number(record.readBigUInt64LE(48));
    }
    if (count > MAX_ENTRIES) throw new Error(`zip 里文件太多（${count} 个）`);
    const directory = readAt(fd, directoryOffset, directorySize);
    const entries: ZipEntry[] = [];
    let at = 0;
    for (let index = 0; index < count; index++) {
      if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error("zip 目录损坏");
      const flags = directory.readUInt16LE(at + 8);
      if (flags & 1) throw new Error("zip 加了密码，解不开");
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      let compressedSize = directory.readUInt32LE(at + 20);
      let size = directory.readUInt32LE(at + 24);
      let offset = directory.readUInt32LE(at + 42);
      const name = directory.subarray(at + 46, at + 46 + nameLength).toString("utf8");
      const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
      for (let e = 0; e + 4 <= extra.length; ) {
        const id = extra.readUInt16LE(e);
        const length = extra.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let field = e + 4;
          if (size === 0xffffffff) {
            size = Number(extra.readBigUInt64LE(field));
            field += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(extra.readBigUInt64LE(field));
            field += 8;
          }
          if (offset === 0xffffffff) offset = Number(extra.readBigUInt64LE(field));
        }
        e += 4 + length;
      }
      entries.push({ name, method: directory.readUInt16LE(at + 10), compressedSize, size, offset });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

/** 包里的路径落到解包目录里；带 .. 或绝对路径的直接拒绝。 */
function safeTarget(root: string, name: string): string {
  const relative = path.posix.normalize(name.replace(/\\/g, "/"));
  if (!relative || relative.startsWith("../") || relative === ".." || relative.startsWith("/") || relative.includes("\0") || /^[A-Za-z]:/.test(relative)) {
    throw new Error(`包里有不安全的路径：${name}`);
  }
  const target = path.join(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error(`包里有不安全的路径：${name}`);
  return target;
}

export async function extractZip(file: string, root: string): Promise<void> {
  const entries = zipEntries(file);
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total > MAX_UNPACKED) throw new Error("zip 解开后太大");
  fs.mkdirSync(root, { recursive: true });
  const fd = fs.openSync(file, "r");
  try {
    for (const entry of entries) {
      if (entry.name.endsWith("/") || entry.name.endsWith("\\")) continue;
      const target = safeTarget(root, entry.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const header = readAt(fd, entry.offset, 30);
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`zip 里 ${entry.name} 损坏`);
      const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (!entry.compressedSize) {
        fs.writeFileSync(target, "");
        continue;
      }
      if (entry.method !== 0 && entry.method !== 8) throw new Error(`zip 里 ${entry.name} 的压缩方式不支持（${entry.method}）`);
      const source = fs.createReadStream(file, { start, end: start + entry.compressedSize - 1 });
      const output = fs.createWriteStream(target, { mode: 0o644 });
      await (entry.method === 8 ? pipeline(source, zlib.createInflateRaw(), output) : pipeline(source, output));
      if (fs.statSync(target).size !== entry.size) throw new Error(`zip 里 ${entry.name} 解出来大小不对`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function isTar(name: string): boolean {
  return /\.(tar|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2?)$/i.test(name);
}

/** tar 先列一遍：有绝对路径、..、链接、设备文件的不解。 */
export async function extractTar(file: string, root: string): Promise<void> {
  const listed = await runProcess("tar", ["-tvf", file], { timeoutMs: 120_000 });
  if (listed.code !== 0) throw new Error(`tar 包读不了：${listed.stderr.trim().slice(0, 200)}`);
  const lines = listed.stdout.split("\n").filter(Boolean);
  if (lines.length > MAX_ENTRIES) throw new Error(`tar 包里文件太多（${lines.length} 个）`);
  if (lines.some((line) => !/^[-d]/.test(line))) throw new Error("tar 包里有链接或特殊文件，不解");
  const names = await runProcess("tar", ["-tf", file], { timeoutMs: 120_000 });
  for (const name of names.stdout.split("\n").filter(Boolean)) safeTarget(root, name.replace(/\/$/, "/x"));
  fs.mkdirSync(root, { recursive: true });
  const done = await runProcess("tar", ["-xf", file, "-C", root, "--no-same-owner", "--no-same-permissions"], { timeoutMs: 600_000 });
  if (done.code !== 0) throw new Error(`tar 包解不开：${done.stderr.trim().slice(0, 200)}`);
}

/** 目录下所有文件，相对路径，按路径排好。 */
export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(path.relative(root, full));
    }
  };
  if (fs.existsSync(root)) visit(root);
  return out.sort();
}

/** 压缩包里再套压缩包（厂商常这么发）：解开里面的 zip 一层。 */
export async function extractNested(root: string): Promise<void> {
  for (const relative of walkFiles(root)) {
    const full = path.join(root, relative);
    if (/\.zip$/i.test(relative) && isZip(full)) {
      await extractZip(full, full.replace(/\.zip$/i, ""));
      fs.rmSync(full);
    } else if (isTar(relative)) {
      await extractTar(full, full.replace(/\.(tar(\.(gz|xz|bz2))?|tgz|txz|tbz2?)$/i, ""));
      fs.rmSync(full);
    }
  }
}

/* ---------- 发布说明 ---------- */

export interface ReleaseNotes {
  board: string;
  kind: FirmwareKind | "";
  version: string;
  models: string[];
  buildDate: string;
  checksum: string;
  checksumSizeMb: number;
  changes: string;
  gigabyte: boolean;
  /** 说明里出现的厂商（见 VENDORS），认不出是空串。 */
  vendor: string;
  /** 「Project Name : S7PH/S7PF」「S7PH series」这类项目代号，不一定是带横杠的整机型号。 */
  projects: string[];
}

/** 发布说明里的厂商字样 → 厂商名。按顺序，先中的算。 */
const VENDORS: [RegExp, string][] = [
  [/GIGA-?BYTE|Giga Computing|技嘉/i, "GIGABYTE"],
  [/\bQUANTA\b|\bQCT\b|广达/i, "QCT"],
  [/Super\s*Micro|\bSMCI\b|超微/i, "Supermicro"],
  [/\bInspur\b|浪潮/i, "Inspur"],
  [/\bxFusion\b|超聚变/i, "xFusion"],
  [/\bHuawei\b|华为/i, "Huawei"],
  [/\bH3C\b|新华三/i, "H3C"],
  [/\bLenovo\b|联想/i, "Lenovo"],
  [/\bDell\b|戴尔/i, "Dell"],
  [/Hewlett Packard|\bHPE\b/i, "HPE"],
  [/\bASRock\s*Rack\b/i, "ASRock Rack"],
  [/\bASUS(?:TeK)?\b|华硕/i, "ASUS"],
  [/\bWiwynn\b|纬颖/i, "Wiwynn"],
  [/\bInventec\b|英业达/i, "Inventec"],
  [/\bFoxconn\b|\bIngrasys\b|富士康|鸿佰/i, "Foxconn"],
  [/\bSugon\b|曙光/i, "Sugon"],
  [/\bNVIDIA\b/i, "NVIDIA"],
];

/** 项目代号：字母数字，至少 3 位，有字母也有数字（S7PH、MZB3-PE2、D55Q-2U），排除纯版本号。 */
const PROJECT_TOKEN = /^(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d)[A-Z0-9][A-Z0-9_-]{2,39}$/i;

function projectTokens(text: string): string[] {
  return text
    .split(/[\s,，;；/、|]+|\band\b/i)
    .map((token) => token.trim().replace(/^[(（<]|[)）>.:]$/g, ""))
    .filter((token) => PROJECT_TOKEN.test(token) && !/^v?\d/i.test(token));
}

const KIND_WORDS: [RegExp, FirmwareKind][] = [
  [/\bBIOS\b/i, "bios"],
  [/\bBMC\b/i, "bmc"],
  [/\bCPLD\b/i, "cpld"],
  [/\b(HGX|HMC)\b/i, "hgx"],
];

function kindOf(text: string): FirmwareKind | "" {
  return KIND_WORDS.find(([pattern]) => pattern.test(text))?.[1] || "";
}

const MODEL_TOKEN = /^[A-Z0-9][A-Z0-9]*(?:-[A-Z0-9]+)+$/i;

/** 发布说明（PDF 转出的文字或 txt）里的标题、版本、适用型号、日期、校验和、这版改了什么。纯函数。 */
export function parseReleaseNotes(text: string): ReleaseNotes {
  const vendor = VENDORS.find(([pattern]) => pattern.test(text.slice(0, 20_000)))?.[1] || "";
  const notes: ReleaseNotes = { board: "", kind: "", version: "", models: [], buildDate: "", checksum: "", checksumSizeMb: 0, changes: "", gigabyte: vendor === "GIGABYTE", vendor, projects: [] };
  const subject = text.match(/SUBJECT:\s*(\S+)\s+(BIOS|BMC|CPLD|FPGA|HMC|Firmware)\s+Release Notes\s+(?:version\s+)?(\S+)/i);
  const generic = subject || text.match(/(?:^|\n)\s*(\S*?)\s*(BIOS|BMC|CPLD|HMC)\s+Release Notes\s+(?:version\s+)?(\S+)/i);
  if (generic) {
    notes.board = generic[1] || "";
    notes.kind = kindOf(generic[2]);
    notes.version = generic[3].replace(/[.,;]$/, "");
  }
  // 技嘉通用 BMC 包（server_firmware_ast2600_*）的发布说明没有「BMC Release Notes」标题，只有一张表：
  //   BMC  OLD: N/A  NEW: N/A  N/A  SUM:0x11D5F360
  //   SMT  OLD:13.06.28  NEW: 13.06.29  2026/08/11  F360, ...
  const smt = generic ? null : text.match(/(?:^|\n)\s*SMT\s+OLD:\s*\S+\s+NEW:\s*(\d+(?:\.\d+)+)\s+(\d{4}\/\d{1,2}\/\d{1,2})/i);
  const bmcSum = smt && text.match(/(?:^|\n)\s*BMC\b[^\n]*?SUM:\s*(0x[0-9A-F]+)/i);
  if (smt && bmcSum) {
    notes.kind = "bmc";
    notes.version = smt[1];
    notes.buildDate = smt[2];
    notes.checksum = `0x${bmcSum[1].slice(2).toUpperCase()}`;
    // 改动表：「F –Feature, B – Bug fixed」之后，本版本那一段（到下一个「版本号(日期)」为止）。
    const table = text.split(/F\s*[–-]\s*Feature,\s*B\s*[–-]\s*Bug fixed/i)[1] || "";
    const header = new RegExp(`(?:^|\\n)[^\\n]*?${smt[1].replace(/\./g, "\\.")}\\s*\\(\\d{4}\\/[^\\n]*`);
    const start = table.match(header);
    if (start) {
      const rest = table.slice((start.index || 0) + start[0].length);
      const end = rest.search(/\n[^\n]*?\d+(?:\.\d+){2,}\s*\(\d{4}\/\d{1,2}\/\d{1,2}\)/);
      notes.changes = (end < 0 ? rest : rest.slice(0, end))
        .split("\n")
        .filter((line) => line.trim() && !/技嘉科技|GIGA\s*-?BYTE TECHNOLOGY/i.test(line))
        .map((line) => line.replace(/\s+$/, "").replace(/^\s{4,}/, "  "))
        .join("\n")
        .slice(0, 4000);
    }
  }
  const system = text.match(/(?:^|\n)\s*(?:System|Systems|Supported (?:System|Platform)s?|Platform)s?\s*:\s*([\s\S]*?)(?=\n\s*\n|\n\s*[A-Z][A-Za-z ]{2,30}:|\n\s*About This Release)/i);
  if (system) {
    notes.models = [...new Set(system[1].split(/[\s,，;；/]+/).map((token) => token.trim()).filter((token) => MODEL_TOKEN.test(token)))];
  }
  genericFields(text, notes);
  // 标题里的主板名（MZB3-PE2）一般是适用列表里某个型号（MZB3-PE2-000）的前缀，那就不另列。
  if (notes.board && MODEL_TOKEN.test(notes.board) && !notes.models.some((model) => model === notes.board || model.startsWith(`${notes.board}-`))) notes.models.unshift(notes.board);
  notes.buildDate = text.match(/Build Date\s*:\s*(\S+)/i)?.[1] || notes.buildDate;
  const checksum = text.match(/Checksum\s*:\s*(0x[0-9A-F]+)(?:\s*\((\d+)\s*M\))?/i);
  if (checksum) {
    notes.checksum = `0x${checksum[1].slice(2).toUpperCase()}`;
    notes.checksumSizeMb = Number(checksum[2] || 0);
  }
  const fixed = notes.changes ? null : text.match(/(?:Issues fixed in this version|Fixed Issues|Changes in this release|What's New)\s*\n([\s\S]*)/i);
  if (fixed) {
    const lines = fixed[1].split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      if (/^\s*-{10,}\s*$/.test(line)) {
        if (kept.some((item) => item.trim())) break;
        continue;
      }
      if (/^\s*\d+\s*$/.test(line) || /BIOS Release Notes|BMC Release Notes/i.test(line)) continue;
      kept.push(line.replace(/\s+$/, ""));
    }
    notes.changes = kept.filter((line) => line.trim()).join("\n").replace(/^\s{4,}/gm, "  ").slice(0, 4000);
  }
  return notes;
}

/**
 * 各家通用的写法，只补前面没认出来的项：
 *   BIOS RELEASE NOTES for S7PH / S7PH series AST2600 BMC FW Release v5.11.00
 *   BIOS Version : 3B05.QCT402 / Version: 5.11.00 (Dual-image)
 *   Project Name : S7PH/S7PF/S8F / Platform: ... / Model Name: ...
 */
function genericFields(text: string, notes: ReleaseNotes): void {
  const head = text.slice(0, 20_000);
  const series = head.match(/(?:^|\n)[^\S\n]*(\S+)\s+series\b[^\n]*?\b(BIOS|BMC|CPLD|FPGA)\b[^\n]*?\bRelease\s+v?(\d[\w.-]*)/i);
  if (series) {
    notes.kind ||= kindOf(series[2]);
    notes.version ||= series[3].replace(/[.,;]$/, "");
    notes.projects.push(...projectTokens(series[1]));
  }
  const titled = head.match(/\b(BIOS|BMC|CPLD|FPGA)\s+RELEASE\s+NOTES?\s+for\s+([^\n]+)/i);
  if (titled) {
    notes.kind ||= kindOf(titled[1]);
    notes.projects.push(...projectTokens(titled[2]));
  }
  // 「XX Version : 值」：带类型字样的优先（BIOS Version），其次光写 Version 的；Core / AFU / Redfish 这类不算。
  const versions = [...head.matchAll(/(?:^|\n)[^\S\n]*(?:(BIOS|BMC|CPLD|FPGA|Firmware|FW)[^\S\n]+)?(?:Version|Ver\.?)[^\S\n]*[:：][^\S\n]*v?(\d[\w.-]*|[A-Z0-9]+\.[\w.-]+)/gi)];
  const typed = versions.find((match) => match[1] && !/^(Firmware|FW)$/i.test(match[1])) || versions.find((match) => match[1]) || versions[0];
  if (typed) {
    notes.version ||= typed[2].replace(/[.,;]$/, "");
    if (typed[1]) notes.kind ||= kindOf(typed[1]);
  }
  for (const match of head.matchAll(/(?:^|\n)[^\S\n]*(?:Project|Platform|Product|Model|Board|Motherboard|Server)(?:[^\S\n]+(?:Name|Code|Model)s?)?[^\S\n]*[:：][^\S\n]*([^\n]+)/gi)) {
    notes.projects.push(...projectTokens(match[1]));
  }
  notes.projects = [...new Set(notes.projects.map((token) => token.toUpperCase()))].slice(0, 30);
  if (!notes.models.length) notes.models = [...notes.projects];
}

/** PDF 转文字（poppler 的 pdftotext）；没装或转不了返回空串。 */
export async function pdfText(file: string): Promise<string> {
  try {
    const result = await runProcess("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { timeoutMs: 30_000, limit: 400_000 });
    return result.code === 0 ? result.stdout : "";
  } catch {
    return "";
  }
}

/* ---------- 镜像 ---------- */

/** 按字节加起来取低 32 位，技嘉发布说明里的 Checksum 就是这么算的。skipTail 是末尾不算的字节数（RBU 的 16 字节尾巴）。 */
export async function byteSum(file: string, skipTail = 0): Promise<number> {
  const size = fs.statSync(file).size;
  const end = size - skipTail;
  if (end <= 0) return 0;
  let sum = 0;
  for await (const chunk of fs.createReadStream(file, { start: 0, end: end - 1, highWaterMark: 1024 * 1024 })) {
    const buffer = chunk as Buffer;
    for (let index = 0; index < buffer.length; index++) sum += buffer[index];
    sum %= 0x100000000;
  }
  return sum >>> 0;
}

/** 技嘉 RBU：BIOS 镜像后面跟 16 字节的 "#GBT#ROM" + 校验和低 16 位。 */
export function rbuTrailer(file: string): { ok: boolean; checksumLow: number } {
  const size = fs.statSync(file).size;
  if (size < 32) return { ok: false, checksumLow: 0 };
  const fd = fs.openSync(file, "r");
  try {
    const tail = readAt(fd, size - 16, 16);
    return { ok: tail.subarray(0, 8).toString("latin1") === "#GBT#ROM", checksumLow: tail.readUInt16LE(8) };
  } finally {
    fs.closeSync(fd);
  }
}

const PLDM_UUIDS = new Set(["f018878ccb7d49439800a02f059aca02", "1244d2648d7d4718a030fc8a56587d5a", "3119ce2fe80a4a99af6d46f8b121f6bf", "7b291c996db64208801b02026e463c78"]);

/**
 * NVIDIA HGX 包里设备记录的名字（ComponentImageSetVersionString）是「类型[,类型]:SKU:」，如 ERoT,NVSwitch:NVD0000000113:、GPU:PG540_SKU216:。
 * 按类型起中文名，并对上 HGX 固件清单里的项（在 B300 机器上逐项核对过版本）。SMA 有两种：NV0004 管 SXM（GPU 板），NV000B 管 ConnectX。
 */
const HGX_PARTS: { type: RegExp; sku?: RegExp; name: string; inventory: string }[] = [
  { type: /^ERoT$/i, name: "ERoT 安全芯片", inventory: "^HGX_FW_ERoT_" },
  { type: /^HMC$/i, name: "HMC（底板管理控制器）", inventory: "^HGX_FW_(BMC|HMC)_\\d+$" },
  { type: /^FPGA$/i, name: "FPGA", inventory: "^HGX_FW_FPGA_\\d+$" },
  { type: /^NVSwitch$/i, name: "NVSwitch", inventory: "^HGX_FW_NVSwitch_\\d+$" },
  { type: /^GPU$/i, name: "GPU VBIOS", inventory: "^HGX_FW_GPU_\\d+$" },
  { type: /^CX8$/i, name: "ConnectX-8 网卡", inventory: "^HGX_FW_ConnectX_\\d+$" },
  { type: /^CX7$/i, name: "ConnectX-7（NVLink 管理网卡）", inventory: "^HGX_FW_NVLinkManagementNIC_\\d+$" },
  { type: /^SMA$/i, sku: /^NV0004$/i, name: "SMA（SXM）", inventory: "^HGX_FW_SXM_SMA_\\d+$" },
  { type: /^SMA$/i, sku: /^NV000B$/i, name: "SMA（ConnectX）", inventory: "^HGX_FW_ConnectX_SMA_\\d+$" },
];

/** 一个部件的名字：被几种设备共用的（ERoT）取它们共有的类型；只属于一种设备的取这个设备最后一个类型，再带上 SKU。 */
function pldmComponentName(devices: { types: string[]; sku: string }[]): Pick<FirmwareComponent, "name" | "inventory" | "sku"> {
  if (!devices.length) return { name: "" };
  const shared = devices[0].types.filter((type) => devices.every((device) => device.types.includes(type)));
  const type = devices.length > 1 ? shared[0] || "" : devices[0].types.at(-1) || "";
  const sku = devices.length === 1 ? devices[0].sku : "";
  const known = HGX_PARTS.find((part) => part.type.test(type) && (!part.sku || part.sku.test(sku)));
  const label = known?.name || type;
  return { name: sku && !label.includes("（") ? `${label}（${sku}）` : label, ...(known ? { inventory: known.inventory } : {}), ...(sku ? { sku } : {}) };
}

export interface PldmPackage {
  version: string;
  releaseDate: string;
  components: FirmwareComponent[];
  /** 设备描述符里厂商自定义的标题和值，如 APSKU=xxx。 */
  descriptors: string[];
  ianaIds: number[];
}

function pldmString(buffer: Buffer, type: number, start: number, length: number): string {
  const raw = buffer.subarray(start, start + length);
  return (type === 4 || type === 5 ? raw.toString("utf16le") : raw.toString(type === 2 ? "utf8" : "latin1")).replace(/\0+$/, "").trim();
}

/** 读 DMTF PLDM 固件包（NVIDIA HGX 的 .fwpkg）的包头：包版本、各部件版本、设备描述符。不是 PLDM 包返回 null。 */
export function parsePldm(file: string): PldmPackage | null {
  const fd = fs.openSync(file, "r");
  try {
    const head = readAt(fd, 0, 19);
    if (head.length < 19 || !PLDM_UUIDS.has(head.subarray(0, 16).toString("hex"))) return null;
    const formatRevision = head[16];
    const headerSize = head.readUInt16LE(17);
    const buffer = readAt(fd, 0, Math.min(headerSize, 4 * 1024 * 1024));
    const timestamp = buffer.subarray(19, 32);
    const releaseDate = timestamp.readUInt16LE(10) > 1900 ? `${timestamp.readUInt16LE(10)}-${String(timestamp[9]).padStart(2, "0")}-${String(timestamp[8]).padStart(2, "0")}` : "";
    const bitmapBits = buffer.readUInt16LE(32);
    const version = pldmString(buffer, buffer[34], 36, buffer[35]);
    let at = 36 + buffer[35];
    const descriptors: string[] = [];
    const ianaIds: number[] = [];
    const bitmapBytes = Math.ceil(bitmapBits / 8);
    const devices: { types: string[]; sku: string; components: number[] }[] = [];
    const readRecords = (withDescriptors: boolean) => {
      const count = buffer[at];
      at += 1;
      for (let index = 0; index < count; index++) {
        const recordLength = buffer.readUInt16LE(at);
        if (withDescriptors) {
          const descriptorCount = buffer[at + 2];
          const versionLength = buffer[at + 8];
          const bitmap = buffer.subarray(at + 11, at + 11 + bitmapBytes);
          const [typeText = "", sku = ""] = pldmString(buffer, buffer[at + 7], at + 11 + bitmapBytes, versionLength).split(":");
          devices.push({
            types: typeText.split(",").map((type) => type.trim()).filter(Boolean),
            sku: sku.trim(),
            components: [...Array(bitmapBits).keys()].filter((bit) => (bitmap[bit >> 3] >> (bit & 7)) & 1),
          });
          let d = at + 11 + bitmapBytes + versionLength;
          for (let k = 0; k < descriptorCount && d + 4 <= at + recordLength; k++) {
            const type = buffer.readUInt16LE(d);
            const length = buffer.readUInt16LE(d + 2);
            const data = buffer.subarray(d + 4, d + 4 + length);
            if (type === 0x0001 && length >= 4) ianaIds.push(data.readUInt32LE(0));
            if (type === 0xffff && length >= 2) {
              const title = pldmString(data, data[0], 2, data[1]);
              const value = data.subarray(2 + data[1]);
              const text = /^[\x20-\x7e]+$/.test(value.toString("latin1").replace(/\0+$/, "")) ? value.toString("latin1").replace(/\0+$/, "") : value.toString("hex");
              descriptors.push(`${title}=${text}`);
            }
            d += 4 + length;
          }
        }
        at += recordLength;
      }
    };
    readRecords(true);
    if (formatRevision >= 2) readRecords(false);
    const componentCount = buffer.readUInt16LE(at);
    at += 2;
    const components: FirmwareComponent[] = [];
    for (let index = 0; index < componentCount && at + 22 <= buffer.length; index++) {
      const identifier = buffer.readUInt16LE(at + 2);
      const versionType = buffer[at + 20];
      const versionLength = buffer[at + 21];
      const named = pldmComponentName(devices.filter((device) => device.components.includes(index)));
      components.push({ ...named, name: named.name || `部件 0x${identifier.toString(16).padStart(4, "0")}`, version: pldmString(buffer, versionType, at + 22, versionLength) });
      at += 22 + versionLength;
      if (formatRevision >= 4) at += 4 + buffer.readUInt32LE(at);
    }
    return { version, releaseDate, components, descriptors: [...new Set(descriptors)], ianaIds: [...new Set(ianaIds)] };
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** 文件前 limit 字节里出现了哪些型号字符串。 */
export function modelsInFile(file: string, candidates: string[], limit = 64 * 1024 * 1024): string[] {
  if (!candidates.length) return [];
  const fd = fs.openSync(file, "r");
  try {
    const buffer = readAt(fd, 0, Math.min(fs.fstatSync(fd).size, limit));
    return candidates.filter((model) => model.length >= 5 && buffer.includes(Buffer.from(model, "latin1")));
  } finally {
    fs.closeSync(fd);
  }
}

/* ---------- 版本 ---------- */

function versionNumbers(version: string): number[] {
  return (version.match(/\d+/g) || []).map(Number);
}

/** 比两个版本号：数字逐段比，如 R05_F04 < R07_F05、13.06.26 < 13.06.27。没有数字或有一边是空的比不出。 */
export function compareVersions(current: string, target: string): VersionRelation {
  const a = current.trim();
  const b = target.trim();
  if (!a || !b) return "unknown";
  if (a.toLowerCase() === b.toLowerCase()) return "same";
  // GPU VBIOS 这种 97.10.7E.00.03 每段是十六进制，按十进制取数字会把 7E 当成 7。
  const hex = /^[0-9a-f]+(\.[0-9a-f]+)+$/i;
  const hexy = hex.test(a) && hex.test(b) && /[a-f]/i.test(a + b);
  const x = hexy ? a.split(".").map((part) => parseInt(part, 16)) : versionNumbers(a);
  const y = hexy ? b.split(".").map((part) => parseInt(part, 16)) : versionNumbers(b);
  if (!x.length || !y.length) return "unknown";
  for (let index = 0; index < Math.max(x.length, y.length); index++) {
    const p = x[index] ?? -1;
    const q = y[index] ?? -1;
    if (p !== q) return p < q ? "older" : "newer";
  }
  return "same";
}

export function versionFromName(name: string): string {
  const base = name.replace(/\.(zip|tar|tgz|tar\.gz|fwpkg|bin|rom|ima|rbu)$/i, "");
  return base.match(/R\d{2,}(?:_F\d+)?/i)?.[0] || base.match(/\d+(?:\.\d+){2,}/)?.[0] || base.match(/[vV](\d+(?:\.\d+)+)/)?.[1] || "";
}

/* ---------- 整包分析 ---------- */

export interface PackageAnalysis {
  vendor: string;
  kind: FirmwareKind;
  version: string;
  models: string[];
  buildDate: string;
  checksum: FirmwareChecksum | null;
  images: FirmwareImage[];
  components: FirmwareComponent[];
  changes: string;
  method: string;
  warnings: string[];
  /** 同一系列的标记：项目代号（code:S7PH）和去掉数字后的目录、镜像文件名（shape:…）。手动填过的型号按它带给同系列的新包。 */
  family: string[];
}

const NVIDIA_IANA = 5703;

/** 文件名去掉数字，同系列不同版本的包一样：3B05.QCT402.BIN → #b#.qct#.bin。 */
function nameShape(name: string): string {
  return name.toLowerCase().replace(/\d+/g, "#");
}

/** 包的系列标记，见 PackageAnalysis.family。 */
export function packageFamily(projects: string[], images: FirmwareImage[]): string[] {
  const shapes = images
    .filter((image) => image.type !== "tool")
    .map((image) => image.path.split("/").map(nameShape).join("/"))
    .sort();
  return [...projects.map((code) => `code:${code.toUpperCase()}`), ...(shapes.length ? [`shape:${shapes.join("|")}`] : [])];
}

/**
 * 分析解开后的目录（单个文件上传时目录里就那一个文件）。knownModels 是机群和型号字典里的型号，
 * 发布说明里没写适用型号时到镜像里找这些字符串。
 */
export async function analyzeTree(root: string, fileName: string, knownModels: string[]): Promise<PackageAnalysis> {
  const files = walkFiles(root);
  const warnings: string[] = [];
  const images: FirmwareImage[] = [];
  const components: FirmwareComponent[] = [];
  let notes: ReleaseNotes | null = null;
  let pldm: PldmPackage | null = null;
  let gigabyte = false;
  let noteVendor = "";
  const projects = new Set<string>();

  // 发布说明：版本号跟文件名对得上的那份当主的，其次版本号最长的；改动每份都收，去重。
  const changeBlocks: string[] = [];
  const score = (parsed: ReleaseNotes) => [Number(fileName.toLowerCase().includes(parsed.version.toLowerCase())), parsed.version.length, parsed.models.length];
  const better = (a: ReleaseNotes, b: ReleaseNotes) => {
    const [x, y] = [score(a), score(b)];
    for (let index = 0; index < x.length; index++) if (x[index] !== y[index]) return x[index] > y[index];
    return false;
  };
  for (const relative of files) {
    const full = path.join(root, relative);
    let text = "";
    if (/\.pdf$/i.test(relative)) text = await pdfText(full);
    else if (/(release|relnote|readme|changelog|notes?)[^/]*\.(txt|md)$/i.test(relative) && fs.statSync(full).size < 1024 * 1024) text = fs.readFileSync(full, "utf8");
    if (!text) continue;
    const parsed = parseReleaseNotes(text);
    if (parsed.gigabyte) gigabyte = true;
    noteVendor ||= parsed.vendor;
    for (const code of parsed.projects) projects.add(code);
    if (parsed.changes && !changeBlocks.includes(parsed.changes)) changeBlocks.push(parsed.changes);
    if (parsed.version && (!notes || better(parsed, notes))) notes = parsed;
  }
  // 技嘉 BMC 包带一份适用机型清单 projects.txt（逗号分开，上千个）。
  let listedModels: string[] = [];
  for (const relative of files) {
    const full = path.join(root, relative);
    if (!/(^|\/)[^/]*projects?[^/]*\.txt$/i.test(relative) || fs.statSync(full).size > 1024 * 1024) continue;
    listedModels = [...new Set([...listedModels, ...fs.readFileSync(full, "utf8").split(/[\s,，;；]+/).filter((token) => MODEL_TOKEN.test(token))])];
  }
  if (files.some((relative) => /\.pdf$/i.test(relative)) && !notes) warnings.push("包里有 PDF 但读不出发布说明（控制台没装 pdftotext 或 PDF 是扫描件）");

  const sums: { file: string; size: number; sum: number }[] = [];
  const hasTool = { afu: false, afuScript: false };
  for (const relative of files) {
    const full = path.join(root, relative);
    const size = fs.statSync(full).size;
    const base = path.basename(relative);
    if (/^afu(lnx|efi|win)/i.test(base) && !/\.(sh|nsh|bat|txt)$/i.test(base)) {
      hasTool.afu = true;
      images.push({ path: relative, size, type: "tool", note: "AMI AFU 刷写程序" });
      continue;
    }
    // \b：Yafuflash（AMI 刷 BMC 的工具）不算 AFU。
    if (/\.(nsh|sh|bat)$/i.test(base) && /\bafu/i.test(fs.readFileSync(full, "latin1").slice(0, 4000))) hasTool.afuScript = true;
    if (/\.rbu$/i.test(base)) {
      const trailer = rbuTrailer(full);
      if (trailer.ok) gigabyte = true;
      images.push({ path: relative, size, type: "rbu", note: trailer.ok ? "技嘉 BMC 带外刷 BIOS 用的镜像（Easy BIOS Refresh）" : "RBU 镜像（尾部标记不认识）" });
      if (size <= 128 * 1024 * 1024) sums.push({ file: relative, size: size - (trailer.ok ? 16 : 0), sum: await byteSum(full, trailer.ok ? 16 : 0) });
      continue;
    }
    const parsed = size >= 64 ? parsePldm(full) : null;
    if (parsed) {
      pldm = pldm || parsed;
      images.push({ path: relative, size, type: "fwpkg", note: `PLDM 固件包，包版本 ${parsed.version || "?"}，${parsed.components.length} 个部件` });
      components.push(...parsed.components);
      continue;
    }
    const ext = base.match(/\.(rom|bin|ima|ima_enc|img|hpm|fwpkg)$/i)?.[1].toLowerCase();
    if (ext && size >= 256 * 1024) {
      const note = ext === "ima" ? "BMC 镜像" : ext === "ima_enc" ? "BMC 加密镜像（网页 / Redfish 升级用）" : "固件镜像";
      images.push({ path: relative, size, type: ext === "rom" ? "rom" : ext === "bin" ? "bin" : "ima", note });
      if (size <= 128 * 1024 * 1024) sums.push({ file: relative, size, sum: await byteSum(full) });
    }
  }

  let checksum: FirmwareChecksum | null = null;
  if (notes?.checksum) {
    const expected = parseInt(notes.checksum, 16) >>> 0;
    const hit = sums.find((item) => item.sum === expected);
    checksum = { expected: notes.checksum, file: hit?.file || "", ok: Boolean(hit) };
    if (!hit) warnings.push(`发布说明里的校验和 ${notes.checksum} 跟包里的镜像都对不上，包可能坏了或不完整`);
  }

  let kind: FirmwareKind = notes?.kind || "other";
  if (!notes?.kind) {
    if (images.some((image) => image.type === "rbu")) kind = "bios";
    else if (pldm) kind = pldm.ianaIds.includes(NVIDIA_IANA) || /HGX|HMC/i.test(pldm.version) ? "hgx" : "other";
    else kind = kindOf(fileName.replace(/[_.]/g, " ")) || (/ast2[56]00/i.test(fileName) || images.some((image) => image.type === "ima") ? "bmc" : "other");
  }

  let models = notes?.models.length ? notes.models : listedModels;
  if (!models.length) {
    const found = new Set<string>();
    for (const image of images.filter((item) => item.type !== "tool")) for (const model of modelsInFile(path.join(root, image.path), knownModels)) found.add(model);
    models = [...found];
    // HGX 包不写整机型号，按 GPU 板卡 SKU 在机群里找（firmware-lib 里补）。
    if (!models.length && !components.some((item) => item.sku && /GPU/i.test(item.name))) warnings.push("认不出适用的机型，请手动填写");
  }

  const version = notes?.version || pldm?.version || versionFromName(fileName);
  if (!version) warnings.push("认不出版本号，请手动填写");
  const vendor = gigabyte ? "GIGABYTE" : pldm?.ianaIds.includes(NVIDIA_IANA) ? "NVIDIA" : noteVendor;

  const methods: string[] = [];
  const rbu = images.find((image) => image.type === "rbu");
  if (rbu) methods.push(`经 BMC 带外刷：用 Redfish 上传 ${rbu.path}，不用进系统，刷完要关机再开机才生效`);
  if (pldm) methods.push("经 BMC 带外刷：用 Redfish 上传 .fwpkg（HGX 底板由 HMC 刷，期间主机会断电重启）");
  if (kind === "bmc" && images.some((image) => image.type === "ima" || image.type === "bin")) methods.push("经 BMC 网页或 Redfish 上传镜像刷 BMC，BMC 会重启，主机不受影响");
  if (hasTool.afu) methods.push("也可以在系统里或 EFI Shell 里用包里的 AFU 刷");
  else if (hasTool.afuScript) warnings.push("包里只有 AFU 刷写脚本，没带 AFU 程序本体（afulnx_64 / AfuEfi64.efi），不能在系统里或 EFI Shell 里刷");
  if (!images.filter((image) => image.type !== "tool").length) warnings.push("包里没找到固件镜像");

  return {
    vendor,
    kind,
    version,
    models,
    buildDate: notes?.buildDate || pldm?.releaseDate || "",
    checksum,
    images,
    components,
    changes: changeBlocks.join("\n\n").slice(0, 8000),
    method: methods.join("；") || "",
    warnings,
    family: packageFamily([...projects], images),
  };
}
