import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseLeases, renderBootIpxe, renderDnsmasq } from "./dnsmasq.ts";
import { assetBmcAccounts, findAssetBySn, getAsset, syncAssetFromRow } from "./assets.ts";
import { refreshBootScript } from "./disk-image.ts";
import { recordHardwareChanges } from "./parts.ts";
import { checkBaseline, diffComponents, generateBaseline, KIND_LABEL } from "./inventory.ts";
import {
  BOOT_DEVICES,
  POWER_ACTIONS,
  bootFromPxe,
  firstWorkingAccount,
  changeIpmiAccount,
  defaultIpmiExec,
  ipmiFailure,
  powerControl,
  powerStatus,
  probeIpmi,
  setBootDevice,
  setIpmiLan,
  type BootDevice,
  type IpmiExec,
  type PowerAction,
} from "./ipmi-remote.ts";
import type { PlanCells } from "./plan-sheet.ts";
import type { ServerCells } from "./server-sheet.ts";
import {
  applyHostname,
  assertAddressRanges,
  chooseInstallAddress,
  listLocalIpv4,
  assertDiskName,
  assertHttpPort,
  assertInterface,
  assertIpmiChannel,
  assertIpv4,
  assertLeaseHours,
  assertPackages,
  assertTimeout,
  assertUsername,
  assertVlanId,
  netmaskToPrefix,
  normalizeMac,
  normalizeSn,
  parseNetmask,
  sameSubnet,
} from "./net.ts";
import { hashPassword } from "./password.ts";
import { ISO_FORMATS_LABEL, isoSuffix, storedSuffix, stripIsoSuffix } from "./iso-name.ts";
import {
  baselinePath,
  dataDir,
  diagDir,
  inventoryDir,
  opticsPath,
  dnsmasqConfPath,
  fileDir,
  ensureDataDirs,
  imageDir,
  incomingDir,
  ipmiPath,
  factPath,
  nicPath,
  serverPath,
  serverImportPath,
  leasePath,
  machinePath,
  profilePath,
  projectPath,
  reportPath,
  scriptBodyPath,
  scriptMetaPath,
  statePath,
  taskPath,
  tftpDir,
} from "./paths.ts";
import {
  DEFAULT_STATE,
  type ApplianceState,
  type Baseline,
  type BaselineRule,
  type BuiltinDiag,
  type HwKind,
  type InventoryMeta,
  type InventorySnapshot,
  type InventorySource,
  type InventoryStatus,
  type OpticsReading,
  type DiagScript,
  type DiskPartition,
  type DiskMode,
  type DiskPick,
  type DiskPolicy,
  type ImageRecord,
  type IpmiSetting,
  type MachineFact,
  type NicPlan,
  type PowerState,
  type Machine,
  type MachineAction,
  type NetworkConfig,
  type Profile,
  type Project,
  type ProjectDhcp,
  type ProjectFixed,
  type RemoteFile,
  type RemoteTask,
  type Report,
  type ServerImportReport,
  type ServerRow,
} from "./types.ts";

let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => T): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function listJson<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson<T>(path.join(dir, name)))
    .filter((item): item is T => item !== null);
}

export function getState(): ApplianceState {
  ensureDataDirs();
  const current = readJson<ApplianceState>(statePath());
  if (!current) {
    writeJson(statePath(), DEFAULT_STATE);
    syncBootFiles(DEFAULT_STATE.network);
    return structuredClone(DEFAULT_STATE);
  }
  return {
    network: { ...DEFAULT_STATE.network, ...current.network },
    builtinDiag: { ...DEFAULT_STATE.builtinDiag, ...current.builtinDiag },
  };
}

export function installServerIp(network: NetworkConfig): string {
  return activeProject()?.dhcp?.serverIp || network.serverIp;
}

export function syncBootFiles(network: NetworkConfig): void {
  ensureDataDirs();
  const active = activeProject();
  fs.writeFileSync(dnsmasqConfPath(), renderDnsmasq(network, active));
  fs.writeFileSync(path.join(tftpDir(), "boot.ipxe"), renderBootIpxe(active?.dhcp?.serverIp || network.serverIp, network.httpPort));
}

export async function saveNetwork(input: NetworkConfig): Promise<ApplianceState> {
  return withLock(() => {
    const state = getState();
    const network: NetworkConfig = {
      pxeInterface: assertInterface(input.pxeInterface),
      serverIp: assertIpv4(input.serverIp, "装机地址"),
      dhcpStart: assertIpv4(input.dhcpStart, "地址池起点"),
      dhcpEnd: assertIpv4(input.dhcpEnd, "地址池终点"),
      netmask: assertIpv4(input.netmask, "子网掩码"),
      gateway: assertIpv4(input.gateway, "网关"),
      dns: assertIpv4(input.dns, "DNS"),
      menuTimeoutSec: assertTimeout(Number(input.menuTimeoutSec)),
      httpPort: assertHttpPort(Number(input.httpPort ?? 80)),
    };
    assertIpv4(network.dns, "DNS");
    assertAddressRanges(network.serverIp, [
      {
        label: "设备地址池",
        start: network.dhcpStart,
        end: network.dhcpEnd,
        netmask: network.netmask,
        gateway: network.gateway,
      },
    ]);
    state.network = network;
    writeJson(statePath(), state);
    syncBootFiles(network);
    return state;
  });
}

export async function saveBuiltinDiag(input: BuiltinDiag): Promise<ApplianceState> {
  return withLock(() => {
    const state = getState();
    state.builtinDiag = {
      cpu: Boolean(input.cpu),
      memory: Boolean(input.memory),
      nic: Boolean(input.nic),
      thermal: Boolean(input.thermal),
      disk: Boolean(input.disk),
      firmware: Boolean(input.firmware),
    };
    writeJson(statePath(), state);
    return state;
  });
}

export function listImages(): ImageRecord[] {
  ensureDataDirs();
  const root = path.join(dataDir(), "images");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson<ImageRecord>(path.join(root, entry.name, "meta.json")))
    .filter((item): item is ImageRecord => item !== null)
    .map(withImageSize)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 已导入的整盘镜像换上当前的启动脚本（pxeimg.cpio 里的 scripts/pxeimg）。 */
export function refreshDiskImageBoot(): void {
  for (const image of listImages()) {
    if (image.kind !== "disk" || image.status !== "ready") continue;
    const file = path.join(imageDir(image.id), "pxeimg.cpio");
    try {
      if (refreshBootScript(file)) console.log(`更新了镜像 ${image.name} 的启动脚本`);
    } catch (error) {
      console.error(`没能更新镜像 ${image.name} 的启动脚本：`, error);
    }
  }
}

/** 早先导入的镜像没有记大小，按 ISO 文件补上。 */
function withImageSize(image: ImageRecord): ImageRecord {
  if (image.size) return image;
  const iso = path.join(imageDir(image.id), "source.iso");
  return fs.existsSync(iso) ? { ...image, size: fs.statSync(iso).size } : image;
}

export function getImage(id: string): ImageRecord | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  const image = readJson<ImageRecord>(path.join(imageDir(id), "meta.json"));
  return image ? withImageSize(image) : null;
}

export function writeImage(record: ImageRecord): void {
  writeJson(path.join(imageDir(record.id), "meta.json"), record);
}

export function listIncoming(): string[] {
  ensureDataDirs();
  return fs
    .readdirSync(incomingDir())
    .filter((name) => isoSuffix(name) && !name.startsWith("."))
    .sort();
}

export interface NewImageInput {
  name: string;
  filename: string;
}

export async function createImageFromIncoming(input: NewImageInput): Promise<ImageRecord> {
  return withLock(() => {
    const filename = path.basename(input.filename);
    const suffix = isoSuffix(filename);
    if (!suffix) throw new Error(`只能导入 ${ISO_FORMATS_LABEL}`);
    const source = path.join(incomingDir(), filename);
    if (!fs.existsSync(source)) throw new Error("incoming 目录里没有这个 ISO");
    const name = input.name.trim() || stripIsoSuffix(filename);
    if (name.length < 2 || name.length > 80) throw new Error("镜像名称需要 2 到 80 个字符");
    const id = crypto.randomUUID();
    const dir = imageDir(id);
    fs.mkdirSync(dir, { recursive: true });
    // 压缩的先原样放着，抽取任务里再解压成 source.iso，免得导入请求卡住。
    const stored = path.join(dir, `source${storedSuffix(suffix)}`);
    fs.renameSync(source, stored);
    const record: ImageRecord = {
      id,
      name,
      family: "ubuntu",
      version: "",
      filename,
      status: "extracting",
      hasTree: false,
      size: fs.statSync(stored).size,
      createdAt: new Date().toISOString(),
    };
    writeImage(record);
    return record;
  });
}

export async function saveUploadedIso(filename: string, bytes: Buffer, name: string): Promise<ImageRecord> {
  const safe = path.basename(filename);
  if (!isoSuffix(safe)) throw new Error(`只能上传 ${ISO_FORMATS_LABEL}`);
  ensureDataDirs();
  const dest = path.join(incomingDir(), safe);
  fs.writeFileSync(dest, bytes);
  return createImageFromIncoming({ filename: safe, name });
}

export async function deleteImage(id: string): Promise<void> {
  return withLock(() => {
    const image = getImage(id);
    if (!image) throw new Error("镜像不存在");
    const used = listProfiles().filter((profile) => profile.imageId === id);
    if (used.length) throw new Error(`还有安装配置在使用这个镜像：${used.map((item) => item.name).join("、")}`);
    fs.rmSync(imageDir(id), { recursive: true, force: true });
  });
}

export function listProfiles(): Profile[] {
  ensureDataDirs();
  return listJson<Profile>(path.join(dataDir(), "profiles")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProfile(id: string): Profile | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  return readJson<Profile>(profilePath(id));
}

export interface ProfileInput {
  name: string;
  imageId: string;
  hostnamePattern: string;
  username: string;
  password?: string;
  diskPolicy: DiskPolicy;
  diskName?: string;
  diskPick?: DiskPick;
  partitions?: DiskPartition[];
  diskMode?: DiskMode;
  packages: string[];
  postScript?: string;
  locale?: string;
  timezone?: string;
  projectId: string;
}

function normalizePartitions(input: DiskPartition[]): DiskPartition[] {
  if (!input.length || input.length > 16) throw new Error("自定义分区需要 1 到 16 个分区");
  const mounts = new Set<string>();
  let rest = 0;
  const partitions = input.map((item) => {
    const mount = item.mount.trim();
    if (mount !== "swap" && !/^\/[A-Za-z0-9._/-]*$/.test(mount)) throw new Error(`挂载点不合法：${mount || "空"}`);
    if (mounts.has(mount)) throw new Error(`挂载点重复：${mount}`);
    mounts.add(mount);
    const raw = item.size.trim().toLowerCase();
    const size = raw === "rest" || raw === "剩余" || raw === "-1" ? "rest" : raw;
    if (size === "rest") rest += 1;
    else if (!/^[1-9]\d{0,6}$/.test(size)) throw new Error(`分区大小用 MB 整数，或填 rest 表示用完剩余空间：${item.mount}`);
    const fs = item.fs;
    if (!["ext4", "xfs", "fat32", "swap"].includes(fs)) throw new Error("文件系统只支持 ext4、xfs、fat32、swap");
    if (mount === "swap" && fs !== "swap") throw new Error("swap 分区的文件系统要选 swap");
    if (mount !== "swap" && fs === "swap") throw new Error("只有挂载点 swap 能使用 swap 文件系统");
    if (mount === "/boot/efi" && fs !== "fat32") throw new Error("/boot/efi 要使用 fat32");
    return { mount, size, fs };
  });
  if (!mounts.has("/")) throw new Error("自定义分区必须包含挂载点 /");
  if (rest !== 1) throw new Error("有且只能有一个分区大小填 rest，用来占用剩余空间");
  return partitions;
}

function normalizeProfileInput(input: ProfileInput, existing?: Profile): Omit<Profile, "id" | "createdAt" | "updatedAt" | "passwordHash"> & { passwordHash: string } {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new Error("配置名称需要 2 到 80 个字符");
  const image = getImage(input.imageId);
  if (!image || image.status !== "ready") throw new Error("请选择一个已经抽取完成的镜像");
  const hostnamePattern = input.hostnamePattern.trim();
  applyHostname(hostnamePattern, "00:11:22:33:44:55");
  const diskPolicy = input.diskPolicy;
  if (!["largest", "smallest", "named", "custom"].includes(diskPolicy)) throw new Error("磁盘策略不合法");
  if (image.kind === "disk" && diskPolicy === "custom") throw new Error("整盘镜像自带分区，不能自定义分区");
  const diskPick: DiskPick = input.diskPick === "smallest" || input.diskPick === "named" ? input.diskPick : "largest";
  const diskName = diskPolicy === "named" || (diskPolicy === "custom" && diskPick === "named") ? assertDiskName(input.diskName || "") : input.diskName?.trim() || "sda";
  const partitions = diskPolicy === "custom" ? normalizePartitions(input.partitions || []) : [];
  const password = input.password?.trim();
  // 整盘镜像里常常已经有账号：用户名留空就不动镜像里的账号，密码留空就不改密码。
  const keepImageAccount = image.kind === "disk" && !input.username?.trim();
  const username = keepImageAccount ? "" : assertUsername(input.username);
  const passwordHash = keepImageAccount ? "" : password ? hashPassword(password) : existing?.passwordHash || "";
  if (!passwordHash && image.kind !== "disk") throw new Error("请设置安装密码");
  const projectId = input.projectId || existing?.projectId;
  if (!projectId || !getProject(projectId)) throw new Error("安装配置必须放在一个项目里");
  return {
    name,
    imageId: image.id,
    projectId,
    hostnamePattern,
    username,
    passwordHash,
    diskPolicy,
    diskName,
    diskPick: diskPolicy === "custom" ? diskPick : undefined,
    partitions,
    diskMode: image.kind === "disk" ? (input.diskMode === "live" ? "live" : "deploy") : undefined,
    packages: assertPackages(input.packages),
    postScript: (input.postScript || "").slice(0, 20000),
    locale: (input.locale || "zh_CN.UTF-8").trim(),
    timezone: (input.timezone || "Asia/Shanghai").trim(),
  };
}

export async function createProfile(input: ProfileInput): Promise<Profile> {
  return withLock(() => {
    const now = new Date().toISOString();
    const profile: Profile = {
      id: crypto.randomUUID(),
      ...normalizeProfileInput(input),
      createdAt: now,
      updatedAt: now,
    };
    writeJson(profilePath(profile.id), profile);
    return profile;
  });
}

export async function updateProfile(id: string, input: ProfileInput): Promise<Profile> {
  return withLock(() => {
    const existing = getProfile(id);
    if (!existing) throw new Error("安装配置不存在");
    const profile: Profile = {
      ...existing,
      ...normalizeProfileInput(input, existing),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    writeJson(profilePath(profile.id), profile);
    return profile;
  });
}

export async function deleteProfile(id: string): Promise<void> {
  return withLock(() => {
    if (!getProfile(id)) throw new Error("安装配置不存在");
    // 绑定是按服务器表自动生成的，配置删了就让这些机器回到菜单，超时后从本地硬盘启动。
    for (const machine of listMachines()) {
      if (machine.profileId !== id) continue;
      writeJson(machinePath(machine.mac), { ...machine, action: "menu", profileId: undefined });
    }
    fs.rmSync(profilePath(id), { force: true });
  });
}

function assertDnsList(value: string, label: string): string {
  const items = value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  if (!items.length) throw new Error(`${label}不能为空`);
  return items.map((item) => assertIpv4(item, label)).join(",");
}

function normalizeDhcp(input: ProjectDhcp, label: string): ProjectDhcp {
  const dns = (input.dns || "").trim();
  const vlanRaw = input.vlan;
  const vlan = vlanRaw === undefined || vlanRaw === null || Number(vlanRaw) === 0 ? undefined : assertVlanId(Number(vlanRaw));
  return {
    start: assertIpv4(input.start, `${label}起点`),
    end: assertIpv4(input.end, `${label}终点`),
    netmask: assertIpv4(input.netmask, `${label}掩码`),
    gateway: assertIpv4(input.gateway, `${label}网关`),
    dns: dns ? assertDnsList(dns, `${label}DNS`).split(",")[0] : "",
    leaseHours: assertLeaseHours(Number(input.leaseHours)),
    serverIp: input.serverIp?.trim() ? assertIpv4(input.serverIp, "本网口地址") : "",
    vlan,
  };
}

function normalizeFixed(input: ProjectFixed): ProjectFixed {
  if (input.mode !== "static" && input.mode !== "dhcp") throw new Error("装完后的网络方式只能是固定地址或 DHCP");
  return {
    mode: input.mode,
    netmask: assertIpv4(input.netmask || "255.255.255.0", "固定网络掩码"),
    gateway: assertIpv4(input.gateway || "0.0.0.0", "固定网络网关"),
    dns: assertDnsList(input.dns || input.gateway || "0.0.0.0", "固定网络 DNS"),
  };
}

function hydrateProject(project: Project): Project {
  return {
    ...project,
    enabled: Boolean(project.enabled),
    dhcp: project.dhcp?.start ? project.dhcp : null,
    fixed: project.fixed?.mode ? project.fixed : null,
  };
}

export function listProjects(): Project[] {
  ensureDataDirs();
  return listJson<Project>(path.join(dataDir(), "projects"))
    .map(hydrateProject)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function activeProject(): Project | null {
  return listProjects().find((project) => project.enabled && project.dhcp) || null;
}

export function profilesForProject(projectId: string): Profile[] {
  return listProfiles().filter((profile) => profile.projectId === projectId);
}

export function getProject(id: string): Project | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  const project = readJson<Project>(projectPath(id));
  return project ? hydrateProject(project) : null;
}

export interface ProjectInput {
  name: string;
  note?: string;
}

export interface ProjectNetworkInput {
  dhcp: ProjectDhcp;
  fixed?: ProjectFixed;
}

function projectName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) throw new Error("项目名称需要 2 到 80 个字符");
  return trimmed;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  return withLock(() => {
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name: projectName(input.name),
      note: (input.note || "").slice(0, 200),
      enabled: false,
      dhcp: null,
      fixed: null,
      createdAt: now,
      updatedAt: now,
    };
    writeJson(projectPath(project.id), project);
    return project;
  });
}

export async function renameProject(id: string, input: ProjectInput): Promise<Project> {
  return withLock(() => {
    const found = getProject(id);
    if (!found) throw new Error("项目不存在");
    const project = {
      ...hydrateProject(found),
      name: projectName(input.name),
      note: (input.note || "").slice(0, 200),
      updatedAt: new Date().toISOString(),
    };
    writeJson(projectPath(project.id), project);
    if (project.enabled) syncBootFiles(getState().network);
    return project;
  });
}

export async function updateProjectNetwork(id: string, input: ProjectNetworkInput): Promise<Project> {
  return withLock(() => {
    const found = getProject(id);
    if (!found) throw new Error("项目不存在");
    const existing = hydrateProject(found);
    const dhcp = normalizeDhcp(input.dhcp, "临时地址池");
    const fixed = input.fixed ? normalizeFixed(input.fixed) : existing.fixed;
    if (input.fixed && fixed?.mode === "static") netmaskToPrefix(fixed.netmask);
    const network = getState().network;
    const serverIp = chooseInstallAddress({
      start: dhcp.start,
      netmask: dhcp.netmask,
      explicit: dhcp.serverIp,
      configured: network.serverIp,
      locals: listLocalIpv4(),
    });
    dhcp.serverIp = serverIp;
    assertAddressRanges(serverIp, [
      {
        label: `项目「${existing.name}」`,
        start: dhcp.start,
        end: dhcp.end,
        netmask: dhcp.netmask,
        gateway: dhcp.gateway,
      },
    ]);
    if (input.fixed && fixed?.mode === "static") {
      for (const machine of listMachines()) {
        if (machine.projectId !== existing.id || !machine.fixedIp) continue;
        if (!sameSubnet(machine.fixedIp, fixed.gateway, fixed.netmask)) {
          throw new Error(`机器 ${machine.mac} 的固定 IP 不在新的固定网络里`);
        }
      }
    }
    const project: Project = { ...existing, dhcp, fixed: fixed ?? null, updatedAt: new Date().toISOString() };
    writeJson(projectPath(project.id), project);
    syncBootFiles(network);
    return project;
  });
}

export async function setProjectEnabled(id: string, enabled: boolean): Promise<Project> {
  return withLock(() => {
    const found = getProject(id);
    if (!found) throw new Error("项目不存在");
    const existing = hydrateProject(found);
    if (enabled && !existing.dhcp) throw new Error("先写好这个项目的 DHCP，再打开开关");
    if (enabled) {
      for (const other of listProjects()) {
        if (other.id === existing.id || !other.enabled) continue;
        writeJson(projectPath(other.id), { ...other, enabled: false, updatedAt: new Date().toISOString() });
      }
    }
    const project: Project = { ...existing, enabled, updatedAt: new Date().toISOString() };
    writeJson(projectPath(project.id), project);
    syncBootFiles(getState().network);
    return project;
  });
}

export async function deleteProject(id: string): Promise<void> {
  return withLock(() => {
    const existing = getProject(id);
    if (!existing) throw new Error("项目不存在");
    const profileIds = new Set(profilesForProject(id).map((profile) => profile.id));
    for (const machine of listMachines()) {
      if (machine.projectId === id) fs.rmSync(machinePath(machine.mac), { force: true });
      else if (machine.profileId && profileIds.has(machine.profileId)) {
        writeJson(machinePath(machine.mac), { ...machine, action: "menu", profileId: undefined });
      }
    }
    for (const profileId of profileIds) fs.rmSync(profilePath(profileId), { force: true });
    for (const task of listTasks(id)) fs.rmSync(taskPath(task.id), { force: true });
    for (const setting of listIpmi()) {
      if (setting.projectId !== id) continue;
      fs.rmSync(ipmiPath(setting.id), { force: true });
    }
    for (const plan of listNicPlans()) {
      if (plan.projectId !== id) continue;
      fs.rmSync(nicPath(plan.id), { force: true });
    }
    for (const server of listServers()) {
      if (server.projectId !== id) continue;
      // 硬件采集和收发光属于资产，删批次不删它们。
      fs.rmSync(serverPath(server.id), { force: true });
    }
    fs.rmSync(baselinePath(id), { force: true });
    for (const fact of listMachineFacts()) {
      if (fact.projectId !== id) continue;
      fs.rmSync(factPath(fact.id), { force: true });
    }
    fs.rmSync(projectPath(id), { force: true });
    syncBootFiles(getState().network);
  });
}

export function listNicsBySn(sn: string): NicPlan[] {
  const active = activeProject();
  if (!active) return [];
  const normalized = normalizeSn(sn);
  const plans = listNicPlans().filter((item) => item.sn === normalized && item.projectId === active.id);
  const row = listServers().find((item) => item.projectId === active.id && item.sn === normalized);
  const fromSheet = row ? serverNicPlan(row) : null;
  // 网卡规划里已经有同一个地址的，以网卡规划为准。
  if (fromSheet && !plans.some((plan) => plan.address === fromSheet.address)) plans.push(fromSheet);
  return plans;
}

export interface IpmiInput {
  sn: string;
  projectId?: string;
  mode: "static" | "dhcp";
  address?: string;
  netmask?: string;
  gateway?: string;
  channel?: number;
  vlanId?: number | null;
  note?: string;
}

function normalizeIpmi(input: IpmiInput, existingId?: string): Omit<IpmiSetting, "id" | "createdAt" | "updatedAt"> {
  const sn = normalizeSn(input.sn);
  const duplicate = listIpmi().find((item) => item.sn === sn && item.projectId === (input.projectId || "") && item.id !== existingId);
  if (duplicate) throw new Error(`序列号 ${sn} 在这个项目里已经有 IPMI 网络设置`);
  if (input.mode !== "static" && input.mode !== "dhcp") throw new Error("IPMI 地址方式只能是固定或 DHCP");
  const project = getProject(input.projectId || "");
  if (!project) throw new Error("IPMI 设置必须放在一个项目里");
  const projectId = project.id;
  const channel = assertIpmiChannel(Number(input.channel ?? 1));
  const vlanId = assertVlanId(input.vlanId);
  const netmask = assertIpv4(input.netmask || "255.255.255.0", "IPMI 掩码");
  const gateway = assertIpv4(input.gateway || "0.0.0.0", "IPMI 网关");
  let address: string | undefined;
  if (input.mode === "static") {
    address = assertIpv4(input.address || "", "IPMI 地址");
    netmaskToPrefix(netmask);
    if (!sameSubnet(address, gateway, netmask)) throw new Error("IPMI 地址和网关不在同一个子网");
    const used = listIpmi().find((item) => item.id !== existingId && item.address === address);
    if (used) throw new Error(`IPMI 地址 ${address} 已经分给序列号 ${used.sn}`);
  }
  return {
    sn,
    projectId: projectId || undefined,
    mode: input.mode,
    address,
    netmask,
    gateway,
    channel,
    vlanId,
    note: (input.note || "").slice(0, 200),
  };
}

export function listIpmi(): IpmiSetting[] {
  ensureDataDirs();
  return listJson<IpmiSetting>(path.join(dataDir(), "ipmi")).sort((a, b) => a.sn.localeCompare(b.sn));
}

export function getIpmi(id: string): IpmiSetting | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  return readJson<IpmiSetting>(ipmiPath(id));
}

export function getIpmiBySn(sn: string): IpmiSetting | null {
  const active = activeProject();
  if (!active) return null;
  const normalized = normalizeSn(sn);
  return listIpmi().find((item) => item.sn === normalized && item.projectId === active.id) || null;
}

export async function createIpmi(input: IpmiInput): Promise<IpmiSetting> {
  return withLock(() => {
    const now = new Date().toISOString();
    const setting: IpmiSetting = {
      id: crypto.randomUUID(),
      ...normalizeIpmi(input),
      createdAt: now,
      updatedAt: now,
    };
    writeJson(ipmiPath(setting.id), setting);
    return setting;
  });
}

export async function updateIpmi(id: string, input: IpmiInput): Promise<IpmiSetting> {
  return withLock(() => {
    const existing = getIpmi(id);
    if (!existing) throw new Error("IPMI 设置不存在");
    const setting: IpmiSetting = {
      ...existing,
      ...normalizeIpmi(input, existing.id),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    writeJson(ipmiPath(setting.id), setting);
    return setting;
  });
}

export function listMachineFacts(): MachineFact[] {
  ensureDataDirs();
  return listJson<MachineFact>(path.join(dataDir(), "facts")).sort((a, b) => a.sn.localeCompare(b.sn));
}

export interface MachineFactInput {
  sn: string;
  mac?: string;
  ipmiAddress?: string;
  biosVersion?: string;
  bmcVersion?: string;
  osVersion?: string;
  power?: PowerState;
}

export async function saveMachineFact(projectId: string, input: MachineFactInput): Promise<MachineFact> {
  return withLock(() => {
    const project = getProject(projectId);
    if (!project) throw new Error("项目不存在");
    const sn = normalizeSn(input.sn);
    const power: PowerState = input.power === "on" || input.power === "off" ? input.power : "unknown";
    const existing = listMachineFacts().find((item) => item.projectId === project.id && item.sn === sn);
    const fact: MachineFact = {
      id: existing?.id || crypto.randomUUID(),
      projectId: project.id,
      sn,
      mac: input.mac ? normalizeMac(input.mac) : existing?.mac,
      ipmiAddress: input.ipmiAddress ? assertIpv4(input.ipmiAddress, "IPMI 地址") : existing?.ipmiAddress,
      biosVersion: (input.biosVersion ?? existing?.biosVersion ?? "").slice(0, 80),
      bmcVersion: (input.bmcVersion ?? existing?.bmcVersion ?? "").slice(0, 80),
      osVersion: (input.osVersion ?? existing?.osVersion ?? "").slice(0, 120),
      power,
      updatedAt: new Date().toISOString(),
    };
    writeJson(factPath(fact.id), fact);
    return fact;
  });
}

export function listNicPlans(): NicPlan[] {
  ensureDataDirs();
  return listJson<NicPlan>(path.join(dataDir(), "nics")).sort(
    (a, b) => a.sn.localeCompare(b.sn) || (a.mac || "").localeCompare(b.mac || "") || (a.iface || "").localeCompare(b.iface || ""),
  );
}

export interface NicInput {
  sn: string;
  projectId: string;
  mac?: string;
  iface?: string;
  label?: string;
  hostname?: string;
  address: string;
  netmask: string;
  gateway?: string;
  dns?: string;
  note?: string;
}

function normalizeNic(input: NicInput, existingId?: string): Omit<NicPlan, "id" | "createdAt" | "updatedAt"> {
  const project = getProject(input.projectId || "");
  if (!project) throw new Error("网卡设置必须放在一个项目里");
  const sn = normalizeSn(input.sn);
  const mac = input.mac?.trim() ? normalizeMac(input.mac) : undefined;
  const iface = input.iface?.trim() ? assertInterface(input.iface) : undefined;
  if (!mac && !iface) throw new Error("要写明这块网卡的 MAC 或接口名，才能知道装完后改哪一块");
  const address = assertIpv4(input.address, "网卡 IP");
  const netmask = assertIpv4(input.netmask || "255.255.255.0", "网卡掩码");
  netmaskToPrefix(netmask);
  const gateway = input.gateway?.trim() ? assertIpv4(input.gateway, "网卡网关") : "";
  if (gateway && !sameSubnet(address, gateway, netmask)) throw new Error("网卡 IP 和网关不在同一个子网");
  const dns = input.dns?.trim() ? assertDnsList(input.dns, "网卡 DNS") : gateway;
  const hostname = input.hostname?.trim() ? applyHostname(input.hostname, "00:11:22:33:44:55") : undefined;
  const label = (input.label || "").replace(/[\r\n]/g, " ").trim().slice(0, 40);
  const others = listNicPlans().filter((item) => item.projectId === project.id && item.id !== existingId);
  const duplicateAddress = others.find((item) => item.address === address);
  if (duplicateAddress) throw new Error(`网卡 IP ${address} 已经分给序列号 ${duplicateAddress.sn}`);
  if (mac && others.some((item) => item.sn === sn && item.mac === mac)) {
    throw new Error(`序列号 ${sn} 上 MAC ${mac} 已经有一条网卡设置`);
  }
  if (iface && others.some((item) => item.sn === sn && item.iface === iface)) {
    throw new Error(`序列号 ${sn} 上接口 ${iface} 已经有一条网卡设置`);
  }
  return {
    projectId: project.id,
    sn,
    mac,
    iface,
    label: label || undefined,
    hostname,
    address,
    netmask,
    gateway,
    dns,
    note: (input.note || "").slice(0, 200),
  };
}

export async function createNic(input: NicInput): Promise<NicPlan> {
  return withLock(() => {
    const now = new Date().toISOString();
    const plan: NicPlan = {
      id: crypto.randomUUID(),
      ...normalizeNic(input),
      createdAt: now,
      updatedAt: now,
    };
    writeJson(nicPath(plan.id), plan);
    return plan;
  });
}

export async function updateNic(id: string, input: NicInput): Promise<NicPlan> {
  return withLock(() => {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error("网卡设置不存在");
    const existing = listNicPlans().find((item) => item.id === id);
    if (!existing) throw new Error("网卡设置不存在");
    const plan: NicPlan = {
      ...existing,
      ...normalizeNic(input, existing.id),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    writeJson(nicPath(plan.id), plan);
    return plan;
  });
}

export async function deleteNic(id: string): Promise<void> {
  return withLock(() => {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id) || !listNicPlans().some((item) => item.id === id)) throw new Error("网卡设置不存在");
    fs.rmSync(nicPath(id), { force: true });
  });
}

export interface PlanImportResult {
  rows: number;
  ipmi: number;
  nic: number;
  machines: number;
  errors: { row: number; message: string }[];
}

export async function importProjectPlan(
  projectId: string,
  records: { row: number; cells: PlanCells }[],
): Promise<PlanImportResult> {
  return withLock(() => {
    const project = getProject(projectId);
    if (!project) throw new Error("项目不存在");
    const result: PlanImportResult = { rows: records.length, ipmi: 0, nic: 0, machines: 0, errors: [] };
    const now = new Date().toISOString();
    const countedMachines = new Set<string>();
    for (const record of records) {
      const cells = record.cells;
      if (!cells.sn && !cells.nicAddress && !cells.ipmiAddress && !cells.mac) continue;
      try {
        const sn = normalizeSn(cells.sn);
        if (cells.ipmiAddress) {
          const existing = listIpmi().find((item) => item.projectId === project.id && item.sn === sn);
          const setting = {
            ...(existing || { id: crypto.randomUUID(), createdAt: now }),
            ...normalizeIpmi(
              {
                sn,
                projectId: project.id,
                mode: "static",
                address: cells.ipmiAddress,
                netmask: cells.ipmiNetmask || project.fixed?.netmask || "255.255.255.0",
                gateway: cells.ipmiGateway || project.fixed?.gateway || "",
                channel: cells.channel ? Number(cells.channel) : 1,
                vlanId: cells.vlan ? Number(cells.vlan) : null,
                note: cells.note,
              },
              existing?.id,
            ),
            updatedAt: now,
          };
          writeJson(ipmiPath(setting.id), setting);
          result.ipmi += 1;
        }
        if (cells.nicAddress) {
          const mac = (cells.nicMac || cells.mac).trim() ? normalizeMac(cells.nicMac || cells.mac) : undefined;
          const iface = cells.nicName.trim() ? assertInterface(cells.nicName) : undefined;
          const existing = listNicPlans().find((item) => {
            if (item.projectId !== project.id || item.sn !== sn) return false;
            if (mac && item.mac === mac) return true;
            if (!mac && iface && item.iface === iface) return true;
            return false;
          });
          const fields = normalizeNic(
            {
              sn,
              projectId: project.id,
              mac,
              iface,
              hostname: cells.hostname,
              address: cells.nicAddress,
              netmask: cells.nicNetmask || "255.255.255.0",
              gateway: cells.nicGateway,
              dns: cells.nicDns,
              note: cells.note,
            },
            existing?.id,
          );
          const plan: NicPlan = {
            id: existing?.id || crypto.randomUUID(),
            ...fields,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
          };
          writeJson(nicPath(plan.id), plan);
          result.nic += 1;
          if (cells.mac.trim()) {
            const machineMac = normalizeMac(cells.mac);
            const machine = getMachine(machineMac) || {
              mac: machineMac,
              action: "menu" as const,
              scriptIds: [],
              note: "",
            };
            machine.projectId = project.id;
            if (cells.note) machine.note = cells.note.slice(0, 200);
            writeJson(machinePath(machine.mac), machine);
            if (!countedMachines.has(machineMac)) {
              countedMachines.add(machineMac);
              result.machines += 1;
            }
          }
        }
      } catch (error) {
        result.errors.push({ row: record.row, message: error instanceof Error ? error.message : "这一行无法导入" });
      }
    }
    return result;
  });
}

export async function deleteIpmi(id: string): Promise<void> {
  return withLock(() => {
    if (!getIpmi(id)) throw new Error("IPMI 设置不存在");
    fs.rmSync(ipmiPath(id), { force: true });
  });
}

export function listMachines(): Machine[] {
  ensureDataDirs();
  return listJson<Machine>(path.join(dataDir(), "machines")).sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
}

export function getMachine(mac: string): Machine | null {
  try {
    return readJson<Machine>(machinePath(normalizeMac(mac)));
  } catch {
    return null;
  }
}

export interface MachineInput {
  mac: string;
  action: MachineAction;
  profileId?: string;
  projectId?: string;
  fixedIp?: string;
  scriptIds?: string[];
  note?: string;
}

export async function saveMachine(input: MachineInput): Promise<Machine> {
  return withLock(() => {
    const mac = normalizeMac(input.mac);
    const action = input.action === "diag" ? "menu" : input.action;
    if (!["menu", "install"].includes(action)) throw new Error("绑定动作不合法");
    let profileId = input.profileId || "";
    if (action === "install") {
      const profile = getProfile(profileId);
      if (!profile) throw new Error("绑定安装时要选择一个安装配置");
      profileId = profile.id;
    } else {
      profileId = "";
    }
    const scriptIds = (input.scriptIds || []).filter((id) => getScript(id));
    let projectId = input.projectId || "";
    let fixedIp = "";
    if (projectId) {
      const project = getProject(projectId);
      if (!project) throw new Error("项目不存在");
      projectId = project.id;
      if (input.fixedIp?.trim()) {
        fixedIp = assertIpv4(input.fixedIp, "固定 IP");
        if (project.fixed?.mode === "static" && project.fixed.gateway) {
          if (!sameSubnet(fixedIp, project.fixed.gateway, project.fixed.netmask)) {
            throw new Error(`固定 IP 必须和项目网关 ${project.fixed.gateway} 在同一个子网`);
          }
        }
        const duplicate = listMachines().find((item) => item.mac !== mac && item.fixedIp === fixedIp);
        if (duplicate) throw new Error(`固定 IP ${fixedIp} 已经分给 ${duplicate.mac}`);
      }
    }
    const existing = getMachine(mac);
    const machine: Machine = {
      mac,
      action,
      profileId: profileId || undefined,
      projectId: projectId || undefined,
      fixedIp: fixedIp || undefined,
      scriptIds,
      note: (input.note || "").slice(0, 200),
      lastSeen: existing?.lastSeen,
    };
    writeJson(machinePath(mac), machine);
    syncBootFiles(getState().network);
    return machine;
  });
}

export async function touchMachine(mac: string): Promise<void> {
  return withLock(() => {
    const normalized = normalizeMac(mac);
    const existing = getMachine(normalized);
    const machine: Machine = existing || {
      mac: normalized,
      action: "menu",
      scriptIds: [],
      note: "",
    };
    machine.lastSeen = new Date().toISOString();
    writeJson(machinePath(normalized), machine);
  });
}

export async function deleteMachine(mac: string): Promise<void> {
  return withLock(() => {
    const normalized = normalizeMac(mac);
    fs.rmSync(machinePath(normalized), { force: true });
    syncBootFiles(getState().network);
  });
}

export function listScripts(): DiagScript[] {
  ensureDataDirs();
  return listJson<DiagScript>(path.join(dataDir(), "scripts")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getScript(id: string): DiagScript | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  return readJson<DiagScript>(scriptMetaPath(id));
}

export function readScriptBody(id: string): string {
  const file = scriptBodyPath(id);
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

export async function createScript(name: string, body: string): Promise<DiagScript> {
  return withLock(() => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) throw new Error("脚本名称需要 2 到 80 个字符");
    if (!body.trim()) throw new Error("脚本内容是空的");
    if (body.length > 200000) throw new Error("脚本超过 200KB");
    const script: DiagScript = {
      id: crypto.randomUUID(),
      name: trimmedName,
      filename: "",
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    script.filename = `${script.id}.sh`;
    writeJson(scriptMetaPath(script.id), script);
    fs.writeFileSync(scriptBodyPath(script.id), body.endsWith("\n") ? body : `${body}\n`, { mode: 0o644 });
    return script;
  });
}

export async function setScriptEnabled(id: string, enabled: boolean): Promise<DiagScript> {
  return withLock(() => {
    const script = getScript(id);
    if (!script) throw new Error("脚本不存在");
    script.enabled = enabled;
    writeJson(scriptMetaPath(script.id), script);
    return script;
  });
}

export async function deleteScript(id: string): Promise<void> {
  return withLock(() => {
    if (!getScript(id)) throw new Error("脚本不存在");
    fs.rmSync(scriptMetaPath(id), { force: true });
    fs.rmSync(scriptBodyPath(id), { force: true });
    for (const machine of listMachines()) {
      if (!machine.scriptIds.includes(id)) continue;
      machine.scriptIds = machine.scriptIds.filter((item) => item !== id);
      writeJson(machinePath(machine.mac), machine);
    }
  });
}

export function listReports(): Report[] {
  ensureDataDirs();
  return listJson<Report>(path.join(dataDir(), "reports")).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}

export function getReport(id: string): Report | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  return readJson<Report>(reportPath(id));
}

export async function createReport(input: Omit<Report, "id">): Promise<Report> {
  return withLock(() => {
    const mac = normalizeMac(input.mac);
    const report: Report = {
      id: crypto.randomUUID(),
      mac,
      startedAt: input.startedAt || new Date().toISOString(),
      finishedAt: input.finishedAt || new Date().toISOString(),
      checks: Array.isArray(input.checks) ? input.checks.slice(0, 50) : [],
      scripts: Array.isArray(input.scripts) ? input.scripts.slice(0, 50) : [],
      mountViolation: Boolean(input.mountViolation),
      ok: Boolean(input.ok) && !input.mountViolation,
    };
    writeJson(reportPath(report.id), report);
    return report;
  });
}

export function diagReady(): boolean {
  const dir = diagDir();
  return ["vmlinuz-lts", "initramfs-lts", "modloop-lts", "diag.apkovl.tar.gz"].every((name) =>
    fs.existsSync(path.join(dir, name)),
  );
}

export function ipxeReady(): { efi: boolean; bios: boolean } {
  return {
    efi: fs.existsSync(path.join(tftpDir(), "ipxe.efi")),
    bios: fs.existsSync(path.join(tftpDir(), "undionly.kpxe")),
  };
}

function assertIpmiUser(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._-]{1,16}$/.test(trimmed)) {
    throw new Error(`${label}需要 1 到 16 位字母、数字、点、下划线或连字符`);
  }
  return trimmed;
}

function assertIpmiPassword(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 20 || /[\r\n\0]/.test(trimmed)) {
    throw new Error(`${label}需要 1 到 20 位，不能换行`);
  }
  return trimmed;
}

function hydrateServer(row: ServerRow): ServerRow {
  return {
    ...row,
    assetId: row.assetId || row.id,
    canApply: row.canApply !== false,
    ipmiAddress: row.ipmiAddress || "",
    ipmiNetmask: row.ipmiNetmask || "",
    ipmiGateway: row.ipmiGateway || "",
    networkApplied: Boolean(row.networkApplied),
    ipmiLink: row.ipmiLink || "unknown",
    ipSource: row.ipSource || "unknown",
    power: row.power || "unknown",
    installed: row.installed || (row.stage === "installing" ? "installing" : "no"),
    passwordChanged: Boolean(row.passwordChanged),
  };
}

/** 写一行装机记录，同时把变了的部分同步到资产。 */
function writeServer(row: ServerRow): void {
  const previousFile = readJson<ServerRow>(serverPath(row.id));
  writeJson(serverPath(row.id), row);
  syncAssetFromRow(previousFile ? hydrateServer(previousFile) : undefined, row);
}

/** 启动时补建资产：老数据里的服务器行还没有对应的资产。 */
export function ensureServerAssets(): number {
  let made = 0;
  for (const row of listServers()) {
    if (getAsset(row.assetId)) continue;
    syncAssetFromRow(undefined, row);
    made++;
  }
  return made;
}

export function listServers(): ServerRow[] {
  ensureDataDirs();
  return listJson<ServerRow>(path.join(dataDir(), "servers"))
    .filter((item) => Boolean(item.sn && item.projectId))
    .map(hydrateServer)
    .sort((a, b) => a.sn.localeCompare(b.sn));
}

export function getServerImportReport(projectId: string): ServerImportReport | null {
  return readJson<ServerImportReport>(serverImportPath(projectId));
}

export function publicServer(row: ServerRow): Omit<ServerRow, "originalPassword" | "targetPassword"> {
  const { originalPassword, targetPassword, ...rest } = row;
  void originalPassword;
  void targetPassword;
  return rest;
}

export interface ServerImportResult {
  rows: number;
  servers: number;
  errors: { row: number; message: string }[];
}

function problemOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * 把一行表格变成服务器记录。上传和页面编辑都走这里，规则一样：
 * IPMI MAC 没变就保留找 BMC 的进度；原账号也没变才保留「已改密码」。
 */
/**
 * 系统地址那几列。填了地址就在装机最后一步配成业务网卡的静态 IP，掩码必填（也可以把地址写成 10.0.0.5/24）。
 * 没填地址就不动系统网络，其余几列不起作用。
 */
function parseOsNetwork(cells: ServerCells, problems: string[]): Pick<ServerRow, "osAddress" | "osNetmask" | "osGateway" | "osDns" | "osNic"> {
  const raw = cells.osAddress?.trim() || "";
  if (!raw) return {};
  const [addressPart, prefixPart] = raw.split("/");
  const out: Pick<ServerRow, "osAddress" | "osNetmask" | "osGateway" | "osDns" | "osNic"> = {};
  try {
    out.osAddress = assertIpv4(addressPart, "系统地址");
  } catch (error) {
    problems.push(problemOf(error, "系统地址不合法"));
    return {};
  }
  const maskText = cells.osNetmask?.trim() || prefixPart?.trim() || "";
  try {
    if (!maskText) {
      problems.push("填了系统地址，还要填系统掩码（或把地址写成 10.0.0.5/24）");
      return out;
    }
    out.osNetmask = parseNetmask(maskText, "系统掩码");
    if (cells.osGateway?.trim()) {
      out.osGateway = assertIpv4(cells.osGateway, "系统网关");
      if (!sameSubnet(out.osAddress, out.osGateway, out.osNetmask)) problems.push("系统地址和系统网关不在同一个子网");
    }
    if (cells.osDns?.trim()) out.osDns = assertDnsList(cells.osDns, "系统 DNS");
    const nic = cells.osNic?.trim() || "";
    if (nic) out.osNic = /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i.test(nic) ? normalizeMac(nic) : assertInterface(nic);
  } catch (error) {
    problems.push(problemOf(error, "系统网络不合法"));
  }
  return out;
}

/** 服务器表里填了系统地址和掩码的机器，装机时按序列号领到这块业务网卡的设置。 */
function serverNicPlan(row: ServerRow): NicPlan | null {
  if (!row.osAddress || !row.osNetmask) return null;
  const isMac = Boolean(row.osNic && row.osNic.includes(":"));
  return {
    id: `server-${row.id}`,
    projectId: row.projectId,
    sn: row.sn,
    mac: isMac ? row.osNic : undefined,
    iface: isMac ? undefined : row.osNic,
    label: "系统地址",
    address: row.osAddress,
    netmask: row.osNetmask,
    gateway: row.osGateway || "",
    dns: row.osDns || "",
    note: "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** siblings 是这个批次现有的行；批量导入时由调用方传进来并随写随更新，不用每行都重读整个目录。 */
function buildServerRow(
  project: Project,
  cells: ServerCells,
  existing: ServerRow | undefined,
  label: string,
  now: string,
  siblings: ServerRow[] = listServers().filter((item) => item.projectId === project.id),
): { row: ServerRow; problems: string[] } {
  const problems: string[] = [];
  let sn = "";
  try {
    sn = normalizeSn(cells.sn);
  } catch (error) {
    problems.push(problemOf(error, "序列号不合法"));
    sn = label;
  }
  let ipmiMac = "";
  try {
    ipmiMac = cells.ipmiMac ? normalizeMac(cells.ipmiMac) : "";
    if (!ipmiMac) problems.push("没有 IPMI MAC");
  } catch (error) {
    problems.push(problemOf(error, "IPMI MAC 不合法"));
  }
  let originalUser = cells.originalUser.trim();
  let originalPassword = cells.originalPassword.trim();
  let targetUser = cells.targetUser.trim();
  let targetPassword = cells.targetPassword.trim();
  try {
    originalUser = assertIpmiUser(cells.originalUser, "原用户");
  } catch (error) {
    problems.push(problemOf(error, "原用户不合法"));
  }
  try {
    originalPassword = assertIpmiPassword(cells.originalPassword, "原密码");
  } catch (error) {
    problems.push(problemOf(error, "原密码不合法"));
  }
  try {
    targetUser = assertIpmiUser(cells.targetUser, "目标用户");
  } catch (error) {
    problems.push(problemOf(error, "目标用户不合法"));
  }
  try {
    targetPassword = assertIpmiPassword(cells.targetPassword, "目标密码");
  } catch (error) {
    problems.push(problemOf(error, "目标密码不合法"));
  }
  const osName = cells.osName.trim().slice(0, 80);
  if (!osName) problems.push("没有填写安装系统");
  const os = parseOsNetwork(cells, problems);
  let ipmiAddress = "";
  let ipmiNetmask = "";
  let ipmiGateway = "";
  let ipmiVlan: number | undefined;
  const hasNetwork = Boolean(cells.ipmiAddress || cells.ipmiNetmask || cells.ipmiGateway);
  if (hasNetwork) {
    try {
      ipmiAddress = assertIpv4(cells.ipmiAddress, "IPMI 地址");
      ipmiNetmask = assertIpv4(cells.ipmiNetmask, "IPMI 掩码");
      ipmiGateway = assertIpv4(cells.ipmiGateway, "IPMI 路由");
      netmaskToPrefix(ipmiNetmask);
      if (!sameSubnet(ipmiAddress, ipmiGateway, ipmiNetmask)) problems.push("IPMI 地址和路由不在同一个子网");
    } catch (error) {
      problems.push(problemOf(error, "IPMI 网络不合法"));
    }
  }
  if (cells.ipmiVlan.trim()) {
    try {
      ipmiVlan = assertVlanId(Number(cells.ipmiVlan));
      if (!ipmiVlan) problems.push("IPMI VLAN 需要是 1 到 4094 的整数");
    } catch (error) {
      problems.push(problemOf(error, "IPMI VLAN 不合法"));
    }
  }
  const others = siblings.filter((item) => item.id !== existing?.id);
  if (ipmiMac) {
    const duplicateMac = others.find((item) => item.ipmiMac === ipmiMac);
    if (duplicateMac) problems.push(`IPMI MAC ${ipmiMac} 已经属于序列号 ${duplicateMac.sn}`);
  }
  if (others.some((item) => item.sn === sn)) problems.push(`序列号 ${sn} 已经在列表里`);
  const sameOs = os.osAddress ? others.find((item) => item.osAddress === os.osAddress) : undefined;
  if (sameOs) problems.push(`系统地址 ${os.osAddress} 已经分给序列号 ${sameOs.sn}`);
  const sameMac = existing?.ipmiMac === ipmiMac;
  // 原账号改了（比如 BMC 恢复过出厂设置），就当还没改过密码，重新用原账号登录。
  const sameAccount = sameMac && existing?.originalUser === originalUser && existing?.originalPassword === originalPassword;
  const keepStage = sameAccount || existing?.stage === "installing";
  const sameNetwork = Boolean(
    existing && existing.ipmiAddress === ipmiAddress && existing.ipmiNetmask === ipmiNetmask && existing.ipmiGateway === ipmiGateway && existing.ipmiVlan === ipmiVlan,
  );
  const canApply = problems.length === 0;
  const id = existing?.id || crypto.randomUUID();
  // 同一序列号已经入库就挂到那台资产上；新机器的资产沿用这一行的 id。
  const assetId = existing && existing.sn === sn ? existing.assetId : findAssetBySn(sn)?.id || (getAsset(id) ? crypto.randomUUID() : id);
  const row: ServerRow = {
    id,
    projectId: project.id,
    assetId,
    sn,
    ipmiMac,
    originalUser,
    originalPassword,
    targetUser,
    targetPassword,
    osName,
    customization: cells.customization.slice(0, 4000),
    ipmiAddress,
    ipmiNetmask,
    ipmiGateway,
    ipmiVlan,
    networkApplied: sameNetwork ? Boolean(existing?.networkApplied) : false,
    bmcIp: sameMac ? existing?.bmcIp : undefined,
    bootMac: sameMac ? existing?.bootMac : undefined,
    ...os,
    passwordChanged: sameAccount ? Boolean(existing?.passwordChanged) : false,
    canApply,
    ipmiLink: sameAccount ? existing?.ipmiLink || "unknown" : "unknown",
    ipSource: sameMac ? existing?.ipSource || "unknown" : "unknown",
    power: sameMac ? existing?.power || "unknown" : "unknown",
    installed: sameMac ? existing?.installed || "no" : "no",
    stage: canApply ? (sameMac && keepStage ? existing?.stage || "waiting" : "waiting") : "error",
    detail: canApply
      ? sameMac && keepStage
        ? existing?.detail || "已列入，等待查看 IPMI"
        : sameMac
          ? "原账号已更新，等待重新登录 BMC"
          : "已列入，等待查看 IPMI"
      : problems.join("；"),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return { row, problems };
}

export async function importServerSheet(projectId: string, records: { row: number; cells: ServerCells }[]): Promise<ServerImportResult> {
  return withLock(() => {
    const project = getProject(projectId);
    if (!project) throw new Error("项目不存在");
    const result: ServerImportResult = { rows: records.length, servers: 0, errors: [] };
    const now = new Date().toISOString();
    // 只读一次目录，之后写一行就更新这份列表。以前每行读两遍，1000 行要读两百万次文件。
    const siblings = listServers().filter((item) => item.projectId === project.id);
    for (const record of records) {
      const cells = record.cells;
      if (!cells.sn && !cells.ipmiMac && !cells.osName && !cells.originalUser) continue;
      let sn = "";
      try {
        sn = normalizeSn(cells.sn);
      } catch {
        sn = "";
      }
      const existing = sn ? siblings.find((item) => item.sn === sn) : undefined;
      const { row, problems } = buildServerRow(project, cells, existing, `第${record.row}行`, now, siblings);
      writeServer(row);
      const index = siblings.findIndex((item) => item.id === row.id);
      if (index >= 0) siblings[index] = row;
      else siblings.push(row);
      result.servers += 1;
      if (problems.length) result.errors.push({ row: record.row, message: problems.join("；") });
    }
    const report: ServerImportReport = {
      projectId: project.id,
      at: now,
      rows: result.rows,
      servers: result.servers,
      errors: result.errors,
    };
    writeJson(serverImportPath(project.id), report);
    return result;
  });
}

/** 页面上改一台或加一台。密码留空表示不改。有问题就不保存，直接告诉用户。 */
export async function saveServer(projectId: string, serverId: string | null, cells: ServerCells): Promise<ServerRow> {
  return withLock(() => {
    const project = getProject(projectId);
    if (!project) throw new Error("项目不存在");
    const existing = serverId ? listServers().find((item) => item.projectId === project.id && item.id === serverId) : undefined;
    if (serverId && !existing) throw new Error("这台机器不在这个项目里，刷新页面再改");
    const filled: ServerCells = {
      ...cells,
      originalPassword: cells.originalPassword.trim() || existing?.originalPassword || "",
      targetPassword: cells.targetPassword.trim() || existing?.targetPassword || "",
    };
    const { row, problems } = buildServerRow(project, filled, existing, "这一行", new Date().toISOString());
    if (problems.length) throw new Error(problems.join("；"));
    writeServer(row);
    return row;
  });
}

export async function deleteServer(projectId: string, serverId: string): Promise<void> {
  return withLock(() => {
    const row = listServers().find((item) => item.projectId === projectId && item.id === serverId);
    if (!row) throw new Error("这台机器不在这个项目里");
    if (row.bootMac) unbindInstall(row.bootMac);
    fs.rmSync(serverPath(row.id), { force: true });
  });
}

const reconciling = new Map<string, Promise<{ changed: boolean }>>();

/**
 * 按租约找 BMC、改账号、拉起安装。上次密码不对的机器只在 force 时重试。BMC 不通时 ipmitool 一次要等 20 秒，
 * 所以连 BMC 时不占数据锁，只在写回每一行时加锁。同一个项目同时只跑一个。
 */
export function reconcileServers(projectId: string, options?: ReconcileOptions): Promise<{ changed: boolean }> {
  const running = reconciling.get(projectId);
  // 手动检查要把密码不对的机器也试一遍，正在跑的自动检查会跳过它们，所以排在后面再跑一次。
  if (running) return options?.force ? running.then(() => reconcileServers(projectId, options)) : running;
  const job = reconcileOnce(projectId, options).finally(() => reconciling.delete(projectId));
  reconciling.set(projectId, job);
  return job;
}

export interface ReconcileOptions {
  exec?: IpmiExec;
  leasesText?: string;
  /** 连上次密码不对的机器也重新登录。自动检查不带它，免得 BMC 因为反复登录失败锁住账号。 */
  force?: boolean;
}

async function reconcileOnce(projectId: string, options?: ReconcileOptions): Promise<{ changed: boolean }> {
  const exec = options?.exec || defaultIpmiExec;
  const leases = parseLeases(options?.leasesText ?? readLeasesText());
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  let changed = false;
  // 同时处理 8 台：BMC 不通时 ipmitool 一次要等 20 秒，一台台串着 100 台不通的就要半个多小时。
  const queue = listServers().filter((item) => item.projectId === project.id);
  const handle = async (row: ServerRow) => {
    const base = row.updatedAt;
    const snapshot = () => {
      const { updatedAt, originalPassword, targetPassword, ...rest } = row;
      return JSON.stringify(rest);
    };
    const before = snapshot();
    const lease = leases.find((item) => item.active && item.mac === row.ipmiMac);
    if (lease) row.bmcIp = lease.ip;
    if (row.canApply && row.bmcIp && row.originalUser && row.originalPassword && (row.ipmiLink !== "denied" || options?.force)) {
      const username = row.passwordChanged ? row.targetUser : row.originalUser;
      const password = row.passwordChanged ? row.targetPassword : row.originalPassword;
      try {
        let probed = await probeIpmi(row.bmcIp, username, password, exec);
        if (probed.link === "denied" && row.passwordChanged) {
          // 目标密码不认、原密码又能登录，多半是 BMC 恢复过出厂设置。重新改一遍账号。
          const original = await probeIpmi(row.bmcIp, row.originalUser, row.originalPassword, exec);
          if (original.link === "up") {
            probed = original;
            row.passwordChanged = false;
          }
        }
        row.ipmiLink = probed.link;
        if (probed.ip) row.bmcIp = probed.ip;
        row.ipSource = probed.source;
        row.power = probed.power;
      } catch {
        row.ipmiLink = "down";
      }
    }
    if (!row.canApply) {
      row.stage = "error";
    } else if (row.installed === "yes") {
      row.detail = `系统已安装。IPMI ${row.ipmiLink === "up" ? "通" : row.ipmiLink === "down" ? "不通" : row.ipmiLink === "denied" ? "账号或密码不对" : "还没探测"}`;
    } else if (!row.bmcIp) {
      row.stage = row.stage === "installing" ? "installing" : "waiting";
      row.detail = "已列入。DHCP 里还没有这个 IPMI MAC";
    } else if (row.ipmiLink === "down") {
      row.stage = "error";
      row.detail = `IPMI 不通，当前地址 ${row.bmcIp}。BMC 没有回应，查网线和 BMC 是否开启 IPMI over LAN`;
    } else if (row.ipmiLink === "denied") {
      const which = row.passwordChanged ? "目标" : "原";
      row.stage = "error";
      row.detail = `BMC ${row.bmcIp} 有回应，但不接受表里的${which}账号 ${row.passwordChanged ? row.targetUser : row.originalUser} 和${which}密码。确认 BMC 现在的密码，改表重传，或点「立即检查」再试`;
    } else if (!project.enabled) {
      if (row.stage !== "installing") row.stage = "waiting";
      row.detail = `已列入，IPMI 地址 ${row.bmcIp}。打开项目开关后才会改账号并安装`;
    } else if (row.stage !== "installing") {
      const profile = profilesForProject(project.id).find((item) => item.name === row.osName);
      try {
        if (row.ipmiAddress && !row.networkApplied) {
          const username = row.passwordChanged ? row.targetUser : row.originalUser;
          const password = row.passwordChanged ? row.targetPassword : row.originalPassword;
          await setIpmiLan(
            {
              host: row.bmcIp,
              username,
              password,
              address: row.ipmiAddress,
              netmask: row.ipmiNetmask,
              gateway: row.ipmiGateway,
              vlan: row.ipmiVlan,
            },
            exec,
          );
          row.networkApplied = true;
          row.bmcIp = row.ipmiAddress;
          row.ipSource = "static";
        }
        if (!row.passwordChanged) {
          await changeIpmiAccount(
            {
              host: row.bmcIp,
              originalUser: row.originalUser,
              originalPassword: row.originalPassword,
              targetUser: row.targetUser,
              targetPassword: row.targetPassword,
            },
            exec,
          );
          row.passwordChanged = true;
        }
        if (!profile) {
          row.stage = "error";
          row.detail = `IPMI 已连通。项目里没有名为「${row.osName}」的安装设置，还不能开始安装`;
        } else if (row.stage !== "ready") {
          await bootFromPxe(row.bmcIp, row.targetUser, row.targetPassword, exec);
          row.stage = "ready";
          row.detail = `已把 IPMI 账号改成 ${row.targetUser}，并让 ${row.bmcIp} 从网卡启动`;
        }
      } catch (error) {
        row.stage = "error";
        row.detail = error instanceof Error ? error.message : "处理这台 BMC 失败";
      }
    }
    if (snapshot() !== before && (await saveReconciled(row, base))) changed = true;
  };
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) await handle(row);
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return { changed };
}

/** 这一行在对账期间被别处改过时，保留那边的状态，只补上对 BMC 做过的事和探测结果。 */
function saveReconciled(row: ServerRow, base: string): Promise<boolean> {
  return withLock(() => {
    const current = readServer(row.id);
    if (!current) return false;
    const now = new Date().toISOString();
    if (current.updatedAt === base) {
      writeServer({ ...row, updatedAt: now });
      return true;
    }
    if (current.ipmiMac !== row.ipmiMac) return false;
    writeServer({
      ...current,
      bmcIp: row.bmcIp,
      ipmiLink: row.ipmiLink,
      ipSource: row.ipSource,
      power: row.power,
      networkApplied: row.networkApplied,
      passwordChanged: row.passwordChanged,
      // 这一轮已经让它从网卡启动了（断电重启过），要记住，不然下一轮又重启一次。
      ...(row.stage === "ready" && current.stage !== "installing" ? { stage: row.stage, detail: row.detail } : {}),
      updatedAt: now,
    });
    return true;
  });
}

/** 按 id 直接读一行，不扫整个目录。 */
function readServer(id: string): ServerRow | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = readJson<ServerRow>(serverPath(id));
  return row && row.sn && row.projectId ? hydrateServer(row) : null;
}

export function getServer(projectId: string, serverId: string): ServerRow | null {
  const row = readServer(serverId);
  return row?.projectId === projectId ? row : null;
}

/** 这台资产在装机批次里的行，新的在前。 */
export function serversOfAsset(assetId: string): ServerRow[] {
  return listServers()
    .filter((row) => row.assetId === assetId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 删资产时一起删它的硬件采集和收发光。装机批次里的行留着，那是装机记录。 */
export function removeAssetFiles(assetId: string): void {
  if (!/^[0-9a-f-]{36}$/.test(assetId)) return;
  fs.rmSync(inventoryDir(assetId), { recursive: true, force: true });
  fs.rmSync(opticsPath(assetId), { force: true });
  fs.rmSync(path.join(dataDir(), "monitor", `${assetId}.sdr`), { force: true });
}

export interface ServerControl {
  /** 先设引导设备，再做电源操作；两个都可以单独给。 */
  boot?: BootDevice;
  persistent?: boolean;
  legacy?: boolean;
  power?: PowerAction;
}

/**
 * 电源和引导按钮。用资产上的 BMC 账号登录，主账号被拒再试备用账号。
 * 和对账一样不在连 BMC 时占数据锁，只在把开关机状态写回装机批次时加锁。
 */
export async function controlAsset(assetId: string, input: ServerControl, exec: IpmiExec = defaultIpmiExec): Promise<{ power: PowerState; message: string }> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("资产不存在");
  if (input.boot !== undefined && !Object.hasOwn(BOOT_DEVICES, input.boot)) throw new Error("不支持的引导设备");
  if (input.power !== undefined && !Object.hasOwn(POWER_ACTIONS, input.power)) throw new Error("不支持的电源操作");
  if (!input.boot && !input.power) throw new Error("没有要执行的操作");
  if (!asset.bmcIp) throw new Error(`${asset.sn} 还没有 BMC 地址，在资产里填上，或等装机批次的 DHCP 发现它`);

  const accounts = assetBmcAccounts(asset);
  if (!accounts.length) throw new Error(`${asset.sn} 没有 BMC 账号密码`);
  const { account, result: power } = await firstWorkingAccount(asset.bmcIp, accounts, exec);
  if (!account) {
    throw new Error(ipmiFailure(power.stderr) === "denied" ? `${asset.sn} 的 BMC ${asset.bmcIp} 不接受资产里的账号密码` : `${asset.sn} 的 BMC ${asset.bmcIp} 没有回应`);
  }

  const done: string[] = [];
  if (input.boot) {
    await setBootDevice(asset.bmcIp, account.user, account.password, { device: input.boot, persistent: input.persistent, legacy: input.legacy }, exec);
    done.push(`${input.persistent ? "以后都" : "下次"}从${BOOT_DEVICES[input.boot].label}启动`);
  }
  let action = input.power;
  // 关着的机器「重启」没有意义，ipmitool 也会报错，直接开机。
  if ((action === "reset" || action === "cycle") && /power is off/i.test(power.stdout)) action = "on";
  if (action) {
    await powerControl(asset.bmcIp, account.user, account.password, action, exec);
    done.push(POWER_ACTIONS[action].label);
  }
  const state = await powerStatus(asset.bmcIp, account.user, account.password, exec).catch(() => "unknown" as const);
  await withLock(() => {
    for (const current of serversOfAsset(assetId)) {
      if (current.power === state && current.ipmiLink === "up") continue;
      writeServer({ ...current, power: state, ipmiLink: "up", updatedAt: new Date().toISOString() });
    }
  });
  return { power: state, message: `${asset.sn}：${done.join("，")}` };
}

export async function bindServerBoot(snRaw: string, macRaw: string): Promise<ServerRow | null> {
  return withLock(() => {
    const active = activeProject();
    if (!active) return null;
    let sn = "";
    let mac = "";
    try {
      sn = normalizeSn(snRaw);
      mac = normalizeMac(macRaw);
    } catch {
      return null;
    }
    const row = listServers().find((item) => item.projectId === active.id && item.sn === sn);
    if (!row) return null;
    const profile = profilesForProject(active.id).find((item) => item.name === row.osName);
    row.bootMac = mac;
    row.updatedAt = new Date().toISOString();
    if (row.installed === "yes") {
      // 装完重启时很多机器还是先从网卡启动。不再绑定安装，菜单超时后回本地硬盘。
      unbindInstall(mac);
      writeServer(row);
      return row;
    }
    if (!profile) {
      row.stage = "error";
      row.detail = `机器已从网卡启动，但项目里没有名为「${row.osName}」的安装设置`;
      writeServer(row);
      return row;
    }
    const existing = getMachine(mac);
    const machine: Machine = {
      mac,
      action: "install",
      profileId: profile.id,
      projectId: active.id,
      scriptIds: existing?.scriptIds || [],
      note: existing?.note || "",
      lastSeen: new Date().toISOString(),
      fixedIp: existing?.fixedIp,
    };
    writeJson(machinePath(mac), machine);
    row.stage = "installing";
    row.installed = "installing";
    // 内存运行不会回报「已安装」，机器每次从网卡启动都重新进内存系统。
    row.detail = runsInRam(profile) ? `正在内存运行「${row.osName}」，不碰硬盘` : `正在安装「${row.osName}」`;
    writeServer(row);
    return row;
  });
}

export async function markServerInstalled(snRaw: string): Promise<void> {
  return withLock(() => {
    let sn = "";
    try {
      sn = normalizeSn(snRaw);
    } catch {
      return;
    }
    const active = activeProject();
    const rows = listServers().filter((item) => item.sn === sn && (!active || item.projectId === active.id));
    for (const row of rows) {
      row.installed = "yes";
      row.stage = "installing";
      row.detail = `「${row.osName || "系统"}」已安装`;
      row.updatedAt = new Date().toISOString();
      writeServer(row);
      if (row.bootMac) unbindInstall(row.bootMac);
    }
  });
}

function unbindInstall(mac: string): void {
  const machine = getMachine(mac);
  if (!machine || machine.action !== "install") return;
  writeJson(machinePath(machine.mac), { ...machine, action: "menu", profileId: undefined });
}

/** 让一台已经装好的机器重装：清掉已安装标记，下次查看 IPMI 时会让它从网卡启动。 */
export async function requestReinstall(projectId: string, serverId: string): Promise<ServerRow> {
  return withLock(() => {
    const project = getProject(projectId);
    if (!project) throw new Error("项目不存在");
    const row = listServers().find((item) => item.projectId === project.id && item.id === serverId);
    if (!row) throw new Error("这台机器不在这个项目里");
    if (!row.canApply) throw new Error("这一行还有问题，先改表再重装");
    row.installed = "no";
    row.stage = "waiting";
    row.detail = project.enabled ? "等待重装，马上会让它从网卡启动" : "等待重装。打开项目开关后会让它从网卡启动";
    row.updatedAt = new Date().toISOString();
    writeServer(row);
    return row;
  });
}

export function customizationForMac(mac: string, projectId: string): string {
  try {
    const normalized = normalizeMac(mac);
    return listServers().find((item) => item.projectId === projectId && item.bootMac === normalized)?.customization || "";
  } catch {
    return "";
  }
}

export function readLeasesText(): string {
  if (!fs.existsSync(leasePath())) return "";
  return fs.readFileSync(leasePath(), "utf8");
}

/** 整盘镜像配置选了内存运行：绑定的机器菜单超时后进内存系统，不写盘。 */
export function runsInRam(profile: Profile): boolean {
  return profile.diskMode === "live" && getImage(profile.imageId)?.kind === "disk";
}

export function publicProfile(profile: Profile): Omit<Profile, "passwordHash"> & { hasPassword: boolean } {
  const { passwordHash, ...rest } = profile;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}

export function listTasks(projectId: string): RemoteTask[] {
  return listAllTasks().filter((task) => task.projectId === projectId);
}

/** 所有项目的任务，新的在前。 */
export function listAllTasks(): RemoteTask[] {
  ensureDataDirs();
  return listJson<RemoteTask>(path.join(dataDir(), "tasks"))
    .map(hydrateTask)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTask(id: string): RemoteTask | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  const task = readJson<RemoteTask>(taskPath(id));
  return task ? hydrateTask(task) : null;
}

/** 只由创建任务的请求和执行任务的那个进程写，所以不进锁。 */
export function writeTask(task: RemoteTask): void {
  writeJson(taskPath(task.id), task);
}

function runnerAlive(task: RemoteTask): boolean {
  const pid = task.runnerPid;
  // 进程刚拉起来、还没写回自己的 pid 时，先当它活着。
  if (!pid) return Date.now() - Date.parse(task.createdAt) < 60000;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hydrateTask(task: RemoteTask): RemoteTask {
  if (task.status !== "running" || runnerAlive(task)) return task;
  return {
    ...task,
    status: "done",
    targets: task.targets.map((target) =>
      target.status === "pending" || target.status === "running"
        ? { ...target, status: "failed", output: `${target.output}\n执行任务的进程已经退出（控制台重启过？），这台没有执行完`.trim() }
        : target,
    ),
  };
}

export function listFiles(): RemoteFile[] {
  ensureDataDirs();
  const root = path.join(dataDir(), "files");
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson<RemoteFile>(path.join(root, entry.name, "meta.json")))
    .filter((item): item is RemoteFile => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getFile(id: string): RemoteFile | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  return readJson<RemoteFile>(path.join(fileDir(id), "meta.json"));
}

export function filePayloadPath(file: RemoteFile): string {
  return path.join(fileDir(file.id), file.name);
}

export function safeFileName(raw: string): string {
  const base = path.basename(raw.trim()).replace(/[^A-Za-z0-9._+-]/g, "_").replace(/^\.+/, "");
  if (!base || base.length > 120) throw new Error("文件名需要 1 到 120 个字符");
  return base;
}

export async function saveFile(rawName: string, body: ReadableStream<Uint8Array> | Readable): Promise<RemoteFile> {
  ensureDataDirs();
  const name = safeFileName(rawName);
  if (listFiles().some((item) => item.name === name)) throw new Error(`已经有一个叫 ${name} 的文件，先删掉旧的再传`);
  const id = crypto.randomUUID();
  const dir = fileDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  try {
    const source = body instanceof Readable ? body : Readable.fromWeb(body as import("node:stream/web").ReadableStream);
    await pipeline(source, fs.createWriteStream(target, { mode: 0o644 }));
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const size = fs.statSync(target).size;
  if (!size) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error("文件是空的");
  }
  const file: RemoteFile = { id, name, size, createdAt: new Date().toISOString() };
  writeJson(path.join(dir, "meta.json"), file);
  return file;
}

export async function deleteFile(id: string): Promise<void> {
  if (!getFile(id)) throw new Error("文件不存在");
  fs.rmSync(fileDir(id), { recursive: true, force: true });
}

/** 每台机器、每个来源留下的采集次数。 */
const INVENTORY_KEEP = 30;
const SNAPSHOT_ID = /^\d{8}T\d{9}Z-(os|bmc|snmp)-[0-9a-f]{6}$/;
const HW_KINDS = Object.keys(KIND_LABEL) as HwKind[];

/** 采集记录的文件名按时间排序，新的在后。 */
function snapshotIds(serverId: string, source?: InventorySource): string[] {
  const dir = inventoryDir(serverId);
  if (!/^[0-9a-f-]{36}$/.test(serverId) || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .filter((id) => SNAPSHOT_ID.test(id) && (!source || id.includes(`-${source}-`)))
    .sort();
}

export function getInventory(serverId: string, id: string): InventorySnapshot | null {
  if (!SNAPSHOT_ID.test(id) || !/^[0-9a-f-]{36}$/.test(serverId)) return null;
  return readJson<InventorySnapshot>(path.join(inventoryDir(serverId), `${id}.json`));
}

/** 新的在前。 */
export function listInventory(serverId: string): InventorySnapshot[] {
  return snapshotIds(serverId)
    .reverse()
    .map((id) => getInventory(serverId, id))
    .filter((item): item is InventorySnapshot => item !== null);
}

export function inventoryMeta(snapshot: InventorySnapshot): InventoryMeta {
  return {
    id: snapshot.id,
    source: snapshot.source,
    at: snapshot.at,
    host: snapshot.host,
    components: snapshot.components.length,
    changes: snapshot.changes ? snapshot.changes.length : null,
  };
}

/**
 * 采集记录写下后不再改，按「资产/记录 id」缓存列表要用的摘要，免得每次打开资产页都把每台的大 JSON 重新解析一遍。
 * 基准检查的结果按基准的更新时间缓存；换了基准才重新读部件。
 */
interface SnapshotSummary {
  at: string;
  changes: number | null;
  issues: Map<string, number>;
}

const summaries = new Map<string, SnapshotSummary>();

function snapshotSummary(serverId: string, id: string, baseline: Baseline | null): SnapshotSummary | null {
  const key = `${serverId}/${id}`;
  let summary = summaries.get(key);
  let snapshot: InventorySnapshot | null = null;
  if (!summary) {
    snapshot = getInventory(serverId, id);
    if (!snapshot) return null;
    summary = { at: snapshot.at, changes: snapshot.changes ? snapshot.changes.length : null, issues: new Map() };
    // 只留最近用到的一批，不让缓存无限长。
    if (summaries.size > 5000) summaries.delete(summaries.keys().next().value!);
    summaries.set(key, summary);
  }
  if (baseline) {
    const baselineKey = `${baseline.projectId}@${baseline.updatedAt}`;
    if (!summary.issues.has(baselineKey)) {
      snapshot ||= getInventory(serverId, id);
      if (snapshot) summary.issues.set(baselineKey, checkBaseline(baseline.rules, snapshot.components).length);
    }
  }
  return summary;
}

/** 服务器列表「硬件」一列用。baseline 由调用方读一次传进来。 */
export function inventoryStatus(serverId: string, baseline: Baseline | null): InventoryStatus {
  const status: InventoryStatus = { issues: null };
  const ids = snapshotIds(serverId);
  for (const source of ["os", "bmc"] as const) {
    const id = ids.filter((item) => item.includes(`-${source}-`)).at(-1);
    const summary = id ? snapshotSummary(serverId, id, baseline?.source === source ? baseline : null) : null;
    if (!summary) continue;
    status[source] = { at: summary.at, changes: summary.changes };
    if (baseline?.source === source) status.issues = summary.issues.get(`${baseline.projectId}@${baseline.updatedAt}`) ?? null;
  }
  return status;
}

export function latestInventory(serverId: string, source: InventorySource): InventorySnapshot | null {
  const id = snapshotIds(serverId, source).at(-1);
  return id ? getInventory(serverId, id) : null;
}

/** 存一次采集，和同来源的上一次比出变化，旧的只留最近 30 次。 */
export async function saveInventory(input: Omit<InventorySnapshot, "id" | "changes">): Promise<InventorySnapshot> {
  return withLock(() => {
    const previous = latestInventory(input.serverId, input.source);
    const stamp = input.at.replace(/[-:.]/g, "");
    const snapshot: InventorySnapshot = {
      ...input,
      id: `${stamp}-${input.source}-${crypto.randomUUID().slice(0, 6)}`,
      ...(previous ? { changes: diffComponents(previous.components, input.components) } : {}),
    };
    writeJson(path.join(inventoryDir(input.serverId), `${snapshot.id}.json`), snapshot);
    if (snapshot.changes?.length) {
      // 记时间线和备件出错不能让采集本身失败。
      try {
        recordHardwareChanges(input.serverId, snapshot.changes, input.source);
      } catch (error) {
        console.error("[inventory] 记录部件变化失败", error);
      }
    }
    for (const old of snapshotIds(input.serverId, input.source).slice(0, -INVENTORY_KEEP)) {
      fs.rmSync(path.join(inventoryDir(input.serverId), `${old}.json`), { force: true });
    }
    return snapshot;
  });
}

export function getBaseline(projectId: string): Baseline | null {
  if (!/^[0-9a-f-]{36}$/.test(projectId)) return null;
  return readJson<Baseline>(baselinePath(projectId));
}

function cleanRules(input: unknown): BaselineRule[] {
  if (!Array.isArray(input)) throw new Error("基准配置的格式不对");
  if (input.length > 500) throw new Error("基准配置最多 500 条");
  return input.map((raw, index) => {
    const rule = raw as Partial<BaselineRule>;
    if (!rule || !HW_KINDS.includes(rule.kind as HwKind)) throw new Error(`第 ${index + 1} 条的类别不对`);
    const count = Number(rule.count);
    if (!Number.isInteger(count) || count < 0 || count > 10000) throw new Error(`第 ${index + 1} 条的数量要是 0 到 10000 的整数`);
    const attrs = Object.fromEntries(
      Object.entries(rule.attrs && typeof rule.attrs === "object" ? rule.attrs : {})
        .map(([key, value]) => [key.slice(0, 40), String(value ?? "").trim().slice(0, 200)])
        .filter(([key, value]) => key && value),
    );
    const firmware = String(rule.firmware ?? "").trim().slice(0, 200);
    return {
      kind: rule.kind as HwKind,
      model: String(rule.model ?? "").trim().slice(0, 300),
      count,
      ...(firmware ? { firmware } : {}),
      ...(Object.keys(attrs).length ? { attrs } : {}),
    };
  });
}

export async function saveBaseline(projectId: string, input: { source?: InventorySource; rules?: unknown; fromSn?: string }): Promise<Baseline> {
  return withLock(() => {
    if (!getProject(projectId)) throw new Error("项目不存在");
    const current = getBaseline(projectId);
    const source = input.source === "bmc" || input.source === "os" ? input.source : current?.source || "os";
    const baseline: Baseline = {
      projectId,
      source,
      rules: cleanRules(input.rules ?? current?.rules ?? []),
      ...(input.fromSn ?? current?.fromSn ? { fromSn: String(input.fromSn ?? current?.fromSn).slice(0, 80) } : {}),
      updatedAt: new Date().toISOString(),
    };
    writeJson(baselinePath(projectId), baseline);
    return baseline;
  });
}

/** 用某台机器最近一次的采集生成项目的基准，替换原来的。 */
export async function baselineFromServer(projectId: string, assetId: string, source: InventorySource): Promise<Baseline> {
  const row = listServers().find((item) => item.projectId === projectId && item.assetId === assetId);
  if (!row) throw new Error("这台机器不在这个装机批次里");
  const snapshot = latestInventory(assetId, source);
  if (!snapshot) throw new Error(`${row.sn} 还没有${source === "os" ? "系统内" : " BMC "}的采集结果`);
  return saveBaseline(projectId, { source, rules: generateBaseline(snapshot.components), fromSn: row.sn });
}

export async function deleteBaseline(projectId: string): Promise<void> {
  return withLock(() => {
    fs.rmSync(baselinePath(projectId), { force: true });
  });
}

/** 一台机器最近一次查询的收发光，只留最新的一次。 */
export function getOptics(serverId: string): OpticsReading | null {
  if (!/^[0-9a-f-]{36}$/.test(serverId)) return null;
  return readJson<OpticsReading>(opticsPath(serverId));
}

export async function saveOptics(reading: OpticsReading): Promise<OpticsReading> {
  return withLock(() => {
    writeJson(opticsPath(reading.serverId), reading);
    return reading;
  });
}
