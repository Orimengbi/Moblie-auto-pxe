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

function fleetMachines(pkg: FirmwarePackage, assets: Asset[], cache: FirmwareCache): FirmwareFleetMachine[] {
  const matches = modelMatcher(pkg.models);
  const inventoryId = INVENTORY_ID[pkg.kind] || "";
  return assets
    .filter((asset) => asset.type === "server" && matches(asset.model))
    .map((asset) => {
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
    inventoryId: INVENTORY_ID[pkg.kind] || "",
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

function isUpgrade(choice: FirmwareChoice): boolean {
  return Boolean(choice.current) && compareVersions(choice.current, choice.version) === "older";
}

export function choicesForAsset(asset: Asset): FirmwareChoice[] {
  const inventory = loadSnapshot<FirmwareItem[]>(asset.id, "firmware")?.data || null;
  return allPackages()
    .map((pkg) => {
      const defaults = PUSH_DEFAULTS[pkg.kind];
      const images = pkg.images.filter((image) => image.type !== "tool").map(({ path: file, size, type }) => ({ path: file, size, type }));
      const preferred = defaults ? defaults.image.map((type) => images.find((image) => image.type === type)).find(Boolean) : undefined;
      const inventoryId = INVENTORY_ID[pkg.kind];
      return {
        id: pkg.id,
        fileName: pkg.fileName,
        vendor: pkg.vendor,
        kind: pkg.kind,
        version: pkg.version,
        models: pkg.models,
        fits: modelMatcher(pkg.models)(asset.model),
        current: (inventoryId && inventory?.find((item) => item.id === inventoryId)?.version) || "",
        images,
        image: (preferred || images[0])?.path || "",
        targets: defaults ? [defaults.target] : [],
        oem: defaults ? { ...defaults.oem } : {},
        prepareHmc: Boolean(defaults?.prepareHmc),
      };
    })
    .filter((choice) => choice.images.length)
    // 型号对得上的在前；其中比这台现在新的在前；再按版本从新到旧。
    .sort((a, b) => Number(b.fits) - Number(a.fits) || Number(isUpgrade(b)) - Number(isUpgrade(a)) || (compareVersions(a.version, b.version) === "older" ? 1 : compareVersions(a.version, b.version) === "newer" ? -1 : 0));
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
  return analyzeTree(unpacked, fileName, knownModels());
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
  const next: FirmwarePackage = { ...pkg, ...found, detected };
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
  return next;
}

export function deletePackage(id: string): FirmwarePackage {
  const pkg = readMeta(id);
  if (!pkg) throw new Error("固件包不存在");
  fs.rmSync(packageDir(id), { recursive: true, force: true });
  return pkg;
}
