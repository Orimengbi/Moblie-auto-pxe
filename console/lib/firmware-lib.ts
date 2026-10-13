import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listAssets } from "./assets.ts";
import { loadSnapshot, type FirmwareItem } from "./bmc-redfish.ts";
import { listCatalog } from "./catalog.ts";
import { analyzeTree, compareVersions, extractNested, extractTar, extractZip, isTar, isZip } from "./firmware-pkg.ts";
import { FIRMWARE_KIND_LABEL, type FirmwareChoice, type FirmwareFleet, type FirmwareFleetMachine, type FirmwareImage, type FirmwareKind, type FirmwarePackage, type FirmwarePackageView } from "./firmware-types.ts";
import { dataDir } from "./paths.ts";
import { safeFileName } from "./store.ts";
import type { Asset } from "./types.ts";

/**
 * 固件库：传进来的固件包存在 data/firmware/<id>/（原包在 pkg/，解开的在 x/，识别结果在 meta.json），
 * 按型号对上机群里的服务器，和它们上次读到的固件版本比，看哪些能升级。
 * 上传分段走（每段 4MB，不超过中间件 10MB 的请求体上限），传完自动解包识别。
 */

const MAX_SIZE = 2 * 1024 * 1024 * 1024;
const ID = /^[0-9a-f-]{36}$/;

function root(): string {
  return path.join(dataDir(), "firmware");
}

function packageDir(id: string): string {
  if (!ID.test(id)) throw new Error("固件包不存在");
  return path.join(root(), id);
}

function uploadsDir(): string {
  return path.join(root(), ".uploads");
}

function readMeta(id: string): FirmwarePackage | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageDir(id), "meta.json"), "utf8")) as FirmwarePackage;
  } catch {
    return null;
  }
}

function writeMeta(pkg: FirmwarePackage): void {
  const file = path.join(packageDir(pkg.id), "meta.json");
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(pkg, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

function allPackages(): FirmwarePackage[] {
  if (!fs.existsSync(root())) return [];
  return fs
    .readdirSync(root())
    .filter((name) => ID.test(name))
    .map((name) => readMeta(name))
    .filter((item): item is FirmwarePackage => item !== null)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/* ---------- 机群对比 ---------- */

/** 这类固件对应机器固件清单（Redfish FirmwareInventory）里的哪一项。 */
const INVENTORY_ID: Partial<Record<FirmwareKind, string>> = { bios: "BIOS", bmc: "BMCImage1", cpld: "MB_CPLD1" };

/** 型号对比时不分大小写，型号字典里登记的别名也算。 */
function modelMatcher(models: string[]): (model: string) => boolean {
  const names = new Set(models.map((model) => model.trim().toLowerCase()).filter(Boolean));
  for (const entry of listCatalog()) {
    const group = [entry.model, ...entry.aliases].map((name) => name.toLowerCase());
    if (group.some((name) => names.has(name))) for (const name of group) names.add(name);
  }
  return (model) => names.has(model.trim().toLowerCase());
}

type FirmwareCache = Map<string, FirmwareItem[] | null>;

function firmwareOf(assetId: string, cache: FirmwareCache): FirmwareItem[] | null {
  if (!cache.has(assetId)) cache.set(assetId, loadSnapshot<FirmwareItem[]>(assetId, "firmware")?.data || null);
  return cache.get(assetId)!;
}

/** GPU 板卡 SKU 对 HGX 固件清单里的 InfoROM：包里写 PG540_SKU216，机器上 HGX_InfoROM_GPU_n 是 G540.0216.00.03。 */
function gpuBoardMatches(items: FirmwareItem[] | null, sku: string): boolean {
  const found = /^PG(\d+)_SKU(\d+)$/i.exec(sku);
  if (!found || !items) return false;
  const prefix = `G${found[1]}.${found[2].padStart(4, "0")}.`.toLowerCase();
  return items.some((item) => /^HGX_InfoROM_GPU_/i.test(item.id) && item.version.toLowerCase().startsWith(prefix));
}

function gpuSku(pkg: { components: FirmwarePackage["components"] }): string {
  return pkg.components.find((item) => item.sku && /^\^HGX_FW_GPU_/.test(item.inventory || ""))?.sku || "";
}

/** HGX 包没写整机型号：读过固件清单、GPU 板卡 SKU 对得上的机器是哪些型号。 */
function modelsByGpuSku(sku: string): string[] {
  const cache: FirmwareCache = new Map();
  const models = new Set<string>();
  for (const asset of listAssets()) if (asset.type === "server" && asset.model && gpuBoardMatches(firmwareOf(asset.id, cache), sku)) models.add(asset.model);
  return [...models];
}

/**
 * HGX 包逐个部件跟机器固件清单比：每个部件对上清单里的几项（8 块 GPU 就是 8 项），
 * 有一项比包旧就算可升级。版本一栏列出跟包不一样的部件。
 */
function hgxRelation(pkg: FirmwarePackage, items: FirmwareItem[]): { version: string; relation: FirmwareFleetMachine["relation"] } {
  const differ: string[] = [];
  const relations = new Set<string>();
  for (const [name, group] of Map.groupBy(pkg.components.filter((item) => item.inventory), (item) => item.name.replace(/（.*）$/, "") + (item.inventory || ""))) {
    const pattern = new RegExp(group[0].inventory!, "i");
    const versions = group.map((item) => item.version);
    const found = items.filter((item) => pattern.test(item.id) && item.version);
    if (!found.length) continue;
    const odd = found.filter((item) => !versions.some((version) => compareVersions(item.version, version) === "same"));
    for (const item of found) relations.add(odd.includes(item) ? compareVersions(item.version, versions[0]) : "same");
    if (odd.length) {
      const label = group[0].name.replace(/（[^）]*\d[^）]*）$/, "");
      const values = [...new Set(odd.map((item) => item.version))].join("、");
      differ.push(`${label || name} ${values}${found.length > 1 ? `（${odd.length}/${found.length}）` : ""}`);
    }
  }
  if (!relations.size) return { version: "", relation: "unknown" };
  const relation = relations.has("older") ? "older" : relations.has("unknown") ? "unknown" : relations.has("newer") ? "newer" : "same";
  return { version: differ.length ? differ.join("；") : "各部件和包一致", relation };
}

function fleetMachines(pkg: FirmwarePackage, assets: Asset[], cache: FirmwareCache): FirmwareFleetMachine[] {
  const matches = modelMatcher(pkg.models);
  const inventoryId = INVENTORY_ID[pkg.kind] || "";
  const hgx = pkg.kind === "hgx" && pkg.components.some((item) => item.inventory);
  const sku = hgx ? gpuSku(pkg) : "";
  return assets
    .filter((asset) => asset.type === "server" && (matches(asset.model) || (sku !== "" && !pkg.models.length && gpuBoardMatches(firmwareOf(asset.id, cache), sku))))
    .map((asset) => {
      if (hgx) {
        const items = firmwareOf(asset.id, cache);
        const compared = items ? hgxRelation(pkg, items) : { version: "", relation: "unread" as const };
        return { id: asset.id, tag: asset.tag, sn: asset.sn, hostname: asset.hostname, bmcIp: asset.bmcIp, ...compared };
      }
      const items = inventoryId ? firmwareOf(asset.id, cache) : null;
      const version = items?.find((item) => item.id === inventoryId)?.version ?? "";
      return {
        id: asset.id,
        tag: asset.tag,
        sn: asset.sn,
        hostname: asset.hostname,
        bmcIp: asset.bmcIp,
        version,
        relation: items ? compareVersions(version, pkg.version) : ("unread" as const),
      };
    });
}

function summarize(pkg: FirmwarePackage, machines: FirmwareFleetMachine[], assets: Asset[]): FirmwareFleet {
  const fleetModels = new Set(assets.filter((asset) => asset.type === "server").map((asset) => asset.model.trim().toLowerCase()));
  const counts = new Map<string, FirmwareFleet["versions"][number]>();
  for (const machine of machines) {
    if (machine.relation === "unread") continue;
    const row = counts.get(machine.version) || { version: machine.version, count: 0, relation: machine.relation };
    row.count++;
    counts.set(machine.version, row);
  }
  return {
    matched: machines.length,
    unread: machines.filter((machine) => machine.relation === "unread").length,
    upgradable: machines.filter((machine) => machine.relation === "older").length,
    versions: [...counts.values()].sort((a, b) => b.count - a.count),
    inventoryId: INVENTORY_ID[pkg.kind] || (pkg.kind === "hgx" && pkg.components.some((item) => item.inventory) ? "HGX_FW_*" : ""),
    models: pkg.models.filter((model) => {
      const matches = modelMatcher([model]);
      return [...fleetModels].some((name) => matches(name));
    }),
  };
}

export function listPackages(): FirmwarePackageView[] {
  const assets = listAssets();
  const cache: FirmwareCache = new Map();
  return allPackages().map((pkg) => ({ ...pkg, fleet: summarize(pkg, fleetMachines(pkg, assets, cache), assets) }));
}

export function getPackage(id: string): (FirmwarePackageView & { machines: FirmwareFleetMachine[] }) | null {
  const pkg = readMeta(id);
  if (!pkg) return null;
  const assets = listAssets();
  const machines = fleetMachines(pkg, assets, new Map());
  return { ...pkg, fleet: summarize(pkg, machines, assets), machines };
}

/** 包里某个文件在磁盘上的位置（以后刷固件时取镜像用）。 */
export function packageFilePath(pkg: FirmwarePackage, relative: string): string {
  const base = path.join(packageDir(pkg.id), "x");
  const full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) throw new Error("路径不对");
  return full;
}

/* ---------- 给一台机器刷 ---------- */

/** 各类固件推给 AMI BMC 时的默认参数；ImageType 取 SimpleUpdate 的 UpdateComponent 那一套名字。对话框里还能改。 */
const PUSH_DEFAULTS: Partial<Record<FirmwareKind, { image: FirmwareImage["type"][]; target: string; oem: Record<string, unknown>; prepareHmc?: boolean }>> = {
  bios: { image: ["rbu", "bin", "rom"], target: "/redfish/v1/UpdateService/FirmwareInventory/BIOS", oem: { ImageType: "BIOS" } },
  bmc: { image: ["ima", "bin"], target: "/redfish/v1/UpdateService/FirmwareInventory/BMCImage1", oem: { ImageType: "BMC" } },
  cpld: { image: ["bin", "rom"], target: "/redfish/v1/UpdateService/FirmwareInventory/MB_CPLD1", oem: { ImageType: "MB_CPLD" } },
  hgx: { image: ["fwpkg"], target: "/redfish/v1/UpdateService/FirmwareInventory/HGX_FW_BMC_0", oem: { ImageType: "HMC" }, prepareHmc: true },
};

const KIND_ORDER: FirmwareKind[] = ["bios", "bmc", "cpld", "hgx", "nic", "other"];

/** 这台能用的包（型号对得上、有能推的镜像）。页面先选部件再选版本；按部件排，同部件里新版本在前。 */
export function choicesForAsset(asset: Asset): FirmwareChoice[] {
  const inventory = loadSnapshot<FirmwareItem[]>(asset.id, "firmware")?.data || null;
  return allPackages()
    .filter((pkg) => modelMatcher(pkg.models)(asset.model))
    .map((pkg) => {
      const defaults = PUSH_DEFAULTS[pkg.kind];
      const images = pkg.images.filter((image) => image.type !== "tool").map(({ path: file, size, type }) => ({ path: file, size, type }));
      const preferred = defaults ? defaults.image.map((type) => images.find((image) => image.type === type)).find(Boolean) : undefined;
      const inventoryId = INVENTORY_ID[pkg.kind];
      let current = "";
      let relation: FirmwareChoice["relation"] = "unknown";
      if (!inventory) relation = "unread";
      else if (pkg.kind === "hgx") ({ version: current, relation } = hgxRelation(pkg, inventory));
      else if (inventoryId) {
        current = inventory.find((item) => item.id === inventoryId)?.version || "";
        relation = compareVersions(current, pkg.version);
      }
      return {
        id: pkg.id,
        fileName: pkg.fileName,
        vendor: pkg.vendor,
        kind: pkg.kind,
        version: pkg.version,
        models: pkg.models,
        current,
        relation,
        images,
        image: (preferred || images[0])?.path || "",
        targets: defaults ? [defaults.target] : [],
        oem: defaults ? { ...defaults.oem } : {},
        prepareHmc: Boolean(defaults?.prepareHmc),
      };
    })
    .filter((choice) => choice.images.length)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (compareVersions(a.version, b.version) === "older" ? 1 : compareVersions(a.version, b.version) === "newer" ? -1 : 0));
}

/** 推之前取镜像：包要在、镜像要是包里列出来的那几个之一。 */
export function choiceImage(packageId: string, image: string): { pkg: FirmwarePackage; file: string } {
  const pkg = readMeta(packageId);
  if (!pkg) throw new Error("固件包不存在");
  const listed = pkg.images.find((item) => item.path === image && item.type !== "tool");
  if (!listed) throw new Error("固件包里没有这个镜像");
  const file = packageFilePath(pkg, listed.path);
  if (!fs.existsSync(file)) throw new Error("镜像文件不见了，到固件库点「重新识别」");
  return { pkg, file };
}

/* ---------- 识别 ---------- */

function knownModels(): string[] {
  const names = new Set<string>();
  for (const asset of listAssets()) if (asset.model) names.add(asset.model);
  for (const entry of listCatalog()) if (entry.category === "server" || entry.category === "switch") for (const name of [entry.model, ...entry.aliases]) names.add(name);
  return [...names];
}

async function sha256(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** 解开 pkg/ 里的原包到 x/（不是压缩包就直接放一份进去），然后识别。 */
async function unpackAndAnalyze(dir: string, fileName: string) {
  const original = path.join(dir, "pkg", fileName);
  const unpacked = path.join(dir, "x");
  fs.rmSync(unpacked, { recursive: true, force: true });
  if (isZip(original)) await extractZip(original, unpacked);
  else if (isTar(fileName)) await extractTar(original, unpacked);
  else {
    fs.mkdirSync(unpacked, { recursive: true });
    fs.linkSync(original, path.join(unpacked, fileName));
  }
  await extractNested(unpacked);
  const found: Awaited<ReturnType<typeof analyzeTree>> & { inheritedFrom?: string } = await analyzeTree(unpacked, fileName, knownModels());
  const sku = found.kind === "hgx" && !found.models.length ? gpuSku(found) : "";
  if (sku) {
    found.models = modelsByGpuSku(sku);
    if (!found.models.length) found.warnings.push(`按 GPU 板卡 ${sku} 在机群里没找到机器（要先读过固件版本），请手动填适用型号`);
  }
  inheritFamily(found, path.basename(dir));
  return found;
}

/** 同一系列：类型一样，项目代号有重合，或者去掉数字后的镜像文件名一样。 */
export function sameFamily(a: { kind: FirmwareKind; family?: string[] }, b: { kind: FirmwareKind; family?: string[] }): boolean {
  if (a.kind !== b.kind || !a.family?.length || !b.family?.length) return false;
  return a.family.some((mark) => b.family!.includes(mark));
}

/**
 * 认不出型号或厂商时，沿用同系列包上的（人手动填的优先，其次新的）。这样每个系列只要填一次。
 * 沿用了就去掉「认不出适用的机型」的提示，换成说明从哪个包带过来的。
 */
function inheritFamily(found: Awaited<ReturnType<typeof analyzeTree>> & { inheritedFrom?: string }, selfId: string): void {
  if (found.models.length && found.vendor) return;
  const source = allPackages()
    .filter((pkg) => pkg.id !== selfId && pkg.models.length && sameFamily(found, pkg))
    .sort((a, b) => Number(b.edited) - Number(a.edited) || b.uploadedAt.localeCompare(a.uploadedAt))[0];
  if (!source) return;
  const took: string[] = [];
  if (!found.models.length) {
    found.models = [...source.models];
    found.warnings = found.warnings.filter((warning) => !/认不出适用的机型/.test(warning));
    took.push("适用型号");
  }
  if (!found.vendor && source.vendor) {
    found.vendor = source.vendor;
    took.push("厂商");
  }
  if (!took.length) return;
  found.inheritedFrom = source.id;
  found.warnings.push(`${took.join("和")}沿用了同系列的 ${source.fileName}${source.edited ? "（手动填的）" : ""}，不对就点「编辑」改`);
}

async function createPackage(file: string, fileName: string, user: string): Promise<FirmwarePackage> {
  const hash = await sha256(file);
  const same = allPackages().find((item) => item.sha256 === hash);
  if (same) throw new Error(`这个包已经在固件库里了（${same.fileName}，${FIRMWARE_KIND_LABEL[same.kind]} ${same.version}）`);
  const id = crypto.randomUUID();
  const dir = packageDir(id);
  fs.mkdirSync(path.join(dir, "pkg"), { recursive: true });
  try {
    fs.renameSync(file, path.join(dir, "pkg", fileName));
    const found = await unpackAndAnalyze(dir, fileName);
    const pkg: FirmwarePackage = {
      id,
      fileName,
      size: fs.statSync(path.join(dir, "pkg", fileName)).size,
      sha256: hash,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user,
      ...found,
      detected: { vendor: found.vendor, kind: found.kind, version: found.version, models: found.models },
      edited: false,
      note: "",
    };
    writeMeta(pkg);
    return pkg;
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** 重新识别（比如控制台升级了识别规则）。人改过的厂商、类型、版本、型号和备注保留。 */
export async function reanalyzePackage(id: string): Promise<FirmwarePackage> {
  const pkg = readMeta(id);
  if (!pkg) throw new Error("固件包不存在");
  const found = await unpackAndAnalyze(packageDir(id), pkg.fileName);
  const detected = { vendor: found.vendor, kind: found.kind, version: found.version, models: found.models };
  const next: FirmwarePackage = { ...pkg, inheritedFrom: undefined, ...found, detected };
  if (pkg.edited) Object.assign(next, { vendor: pkg.vendor, kind: pkg.kind, version: pkg.version, models: pkg.models });
  writeMeta(next);
  return next;
}

/* ---------- 上传 ---------- */

interface UploadMeta {
  id: string;
  fileName: string;
  size: number;
  user: string;
  createdAt: string;
}

function uploadPaths(id: string) {
  if (!ID.test(id)) throw new Error("上传不存在");
  return { meta: path.join(uploadsDir(), `${id}.json`), part: path.join(uploadsDir(), `${id}.part`) };
}

export function openFirmwareUpload(input: { filename?: unknown; size?: unknown }, user: string): { id: string; offset: number } {
  const fileName = safeFileName(String(input.filename || ""));
  const size = Number(input.size);
  if (!Number.isInteger(size) || size <= 0) throw new Error("文件大小不对");
  if (size > MAX_SIZE) throw new Error("固件包最大 2 GB");
  fs.mkdirSync(uploadsDir(), { recursive: true });
  // 一天前没传完的扔掉。
  for (const name of fs.readdirSync(uploadsDir())) {
    const full = path.join(uploadsDir(), name);
    if (Date.now() - fs.statSync(full).mtimeMs > 86_400_000) fs.rmSync(full, { force: true });
  }
  const id = crypto.randomUUID();
  const paths = uploadPaths(id);
  fs.writeFileSync(paths.meta, JSON.stringify({ id, fileName, size, user, createdAt: new Date().toISOString() } satisfies UploadMeta));
  fs.writeFileSync(paths.part, "");
  return { id, offset: 0 };
}

export class FirmwareUploadConflict extends Error {
  readonly offset: number;
  constructor(offset: number) {
    super("上传位置不对");
    this.offset = offset;
  }
}

/** 追加一段；最后一段到了就解包识别，返回识别好的固件包。 */
export async function appendFirmwareUpload(id: string, offset: number, bytes: Buffer): Promise<{ offset: number; package: FirmwarePackage | null }> {
  const paths = uploadPaths(id);
  if (!fs.existsSync(paths.meta)) throw new Error("上传不存在或已经过期，重新传");
  const meta = JSON.parse(fs.readFileSync(paths.meta, "utf8")) as UploadMeta;
  const current = fs.statSync(paths.part).size;
  if (offset !== current) throw new FirmwareUploadConflict(current);
  if (current + bytes.length > meta.size) throw new Error("传上来的比文件还大");
  fs.appendFileSync(paths.part, bytes);
  const next = current + bytes.length;
  if (next < meta.size) return { offset: next, package: null };
  try {
    return { offset: next, package: await createPackage(paths.part, meta.fileName, meta.user) };
  } finally {
    fs.rmSync(paths.part, { force: true });
    fs.rmSync(paths.meta, { force: true });
  }
}

export function discardFirmwareUpload(id: string): void {
  const paths = uploadPaths(id);
  fs.rmSync(paths.part, { force: true });
  fs.rmSync(paths.meta, { force: true });
}

/* ---------- 改、删 ---------- */

export interface FirmwarePackageInput {
  vendor?: unknown;
  kind?: unknown;
  version?: unknown;
  models?: unknown;
  note?: unknown;
}

export function updatePackage(id: string, input: FirmwarePackageInput): FirmwarePackage {
  const pkg = readMeta(id);
  if (!pkg) throw new Error("固件包不存在");
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const next = { ...pkg };
  if (input.vendor !== undefined) next.vendor = text(input.vendor, 60);
  if (input.kind !== undefined) {
    if (!(String(input.kind) in FIRMWARE_KIND_LABEL)) throw new Error("固件类型不对");
    next.kind = input.kind as FirmwareKind;
  }
  if (input.version !== undefined) next.version = text(input.version, 80);
  if (input.models !== undefined) {
    const list = Array.isArray(input.models) ? input.models : String(input.models).split(/[\s,，;；]+/);
    next.models = [...new Set(list.map((model) => String(model).trim()).filter(Boolean))].slice(0, 50);
  }
  if (input.note !== undefined) next.note = text(input.note, 2000);
  const d = next.detected;
  next.edited = next.vendor !== d.vendor || next.kind !== d.kind || next.version !== d.version || next.models.join("\n") !== d.models.join("\n");
  writeMeta(next);
  // 同系列里还空着型号、没人改过的包，一起填上。
  if (next.models.length && input.models !== undefined) {
    for (const other of allPackages()) {
      if (other.id === next.id || other.edited || other.models.length || !sameFamily(other, next)) continue;
      const vendor = other.vendor || next.vendor;
      writeMeta({
        ...other,
        models: [...next.models],
        vendor,
        detected: { ...other.detected, models: [...next.models], vendor },
        inheritedFrom: next.id,
        warnings: [...other.warnings.filter((warning) => !/认不出适用的机型/.test(warning)), `适用型号沿用了同系列的 ${next.fileName}（手动填的），不对就点「编辑」改`],
      });
    }
  }
  return next;
}

export function deletePackage(id: string): FirmwarePackage {
  const pkg = readMeta(id);
  if (!pkg) throw new Error("固件包不存在");
  fs.rmSync(packageDir(id), { recursive: true, force: true });
  return pkg;
}
