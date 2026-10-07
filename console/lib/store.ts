import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseLeases, renderBootIpxe, renderDnsmasq } from "./dnsmasq.ts";
import {
  BOOT_DEVICES,
  POWER_ACTIONS,
  bootFromPxe,
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
  sameSubnet,
} from "./net.ts";
import { hashPassword } from "./password.ts";
import { ISO_FORMATS_LABEL, isoSuffix, storedSuffix, stripIsoSuffix } from "./iso-name.ts";
import {
  dataDir,
  diagDir,
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
  type BuiltinDiag,
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
      fs.rmSync(serverPath(server.id), { force: true });
    }
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
  return listNicPlans().filter((item) => item.sn === normalized && item.projectId === active.id);
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
function buildServerRow(project: Project, cells: ServerCells, existing: ServerRow | undefined, label: string, now: string): { row: ServerRow; problems: string[] } {
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
  let osAddress = "";
  if (cells.osAddress?.trim()) {
    try {
      osAddress = assertIpv4(cells.osAddress, "系统地址");
    } catch (error) {
      problems.push(problemOf(error, "系统地址不合法"));
    }
  }
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
  const others = listServers().filter((item) => item.projectId === project.id && item.id !== existing?.id);
  if (ipmiMac) {
    const duplicateMac = others.find((item) => item.ipmiMac === ipmiMac);
    if (duplicateMac) problems.push(`IPMI MAC ${ipmiMac} 已经属于序列号 ${duplicateMac.sn}`);
  }
  if (others.some((item) => item.sn === sn)) problems.push(`序列号 ${sn} 已经在列表里`);
  const sameMac = existing?.ipmiMac === ipmiMac;
  // 原账号改了（比如 BMC 恢复过出厂设置），就当还没改过密码，重新用原账号登录。
  const sameAccount = sameMac && existing?.originalUser === originalUser && existing?.originalPassword === originalPassword;
  const keepStage = sameAccount || existing?.stage === "installing";
  const sameNetwork = Boolean(
    existing && existing.ipmiAddress === ipmiAddress && existing.ipmiNetmask === ipmiNetmask && existing.ipmiGateway === ipmiGateway && existing.ipmiVlan === ipmiVlan,
  );
  const canApply = problems.length === 0;
  const row: ServerRow = {
    id: existing?.id || crypto.randomUUID(),
    projectId: project.id,
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
    osAddress: osAddress || undefined,
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
    for (const record of records) {
      const cells = record.cells;
      if (!cells.sn && !cells.ipmiMac && !cells.osName && !cells.originalUser) continue;
      let sn = "";
      try {
        sn = normalizeSn(cells.sn);
      } catch {
        sn = "";
      }
      const existing = sn ? listServers().find((item) => item.projectId === project.id && item.sn === sn) : undefined;
      const { row, problems } = buildServerRow(project, cells, existing, `第${record.row}行`, now);
      writeJson(serverPath(row.id), row);
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
    writeJson(serverPath(row.id), row);
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
  for (const row of listServers()) {
    if (row.projectId !== project.id) continue;
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
  }
  return { changed };
}

/** 这一行在对账期间被别处改过时，保留那边的状态，只补上对 BMC 做过的事和探测结果。 */
function saveReconciled(row: ServerRow, base: string): Promise<boolean> {
  return withLock(() => {
    const current = listServers().find((item) => item.id === row.id);
    if (!current) return false;
    const now = new Date().toISOString();
    if (current.updatedAt === base) {
      writeJson(serverPath(row.id), { ...row, updatedAt: now });
      return true;
    }
    if (current.ipmiMac !== row.ipmiMac) return false;
    writeJson(serverPath(row.id), {
      ...current,
      bmcIp: row.bmcIp,
      ipmiLink: row.ipmiLink,
      ipSource: row.ipSource,
      power: row.power,
      networkApplied: row.networkApplied,
      passwordChanged: row.passwordChanged,
      updatedAt: now,
    });
    return true;
  });
}

/** BMC 现在最可能接受的账号在前：改过账号用目标账号，原账号兜底。 */
export function bmcAccounts(row: ServerRow): { user: string; password: string }[] {
  return [
    ...(row.passwordChanged ? [{ user: row.targetUser, password: row.targetPassword }] : []),
    { user: row.originalUser, password: row.originalPassword },
  ].filter((item) => item.user && item.password);
}

export function getServer(projectId: string, serverId: string): ServerRow | null {
  return listServers().find((item) => item.projectId === projectId && item.id === serverId) || null;
}

export interface ServerControl {
  /** 先设引导设备，再做电源操作；两个都可以单独给。 */
  boot?: BootDevice;
  persistent?: boolean;
  legacy?: boolean;
  power?: PowerAction;
}

/**
 * 服务器列表里的电源和引导按钮。用 BMC 现在的账号登录：改过账号用目标账号，目标账号被拒再试原账号。
 * 和对账一样不在连 BMC 时占数据锁，只在写回开关机状态时加锁。
 */
export async function controlServer(
  projectId: string,
  serverId: string,
  input: ServerControl,
  exec: IpmiExec = defaultIpmiExec,
): Promise<{ row: ServerRow; message: string }> {
  const row = listServers().find((item) => item.projectId === projectId && item.id === serverId);
  if (!row) throw new Error("这台机器不在这个项目里");
  if (input.boot !== undefined && !Object.hasOwn(BOOT_DEVICES, input.boot)) throw new Error("不支持的引导设备");
  if (input.power !== undefined && !Object.hasOwn(POWER_ACTIONS, input.power)) throw new Error("不支持的电源操作");
  if (!input.boot && !input.power) throw new Error("没有要执行的操作");
  if (!row.bmcIp) throw new Error(`${row.sn} 还没有 IPMI 地址，等 DHCP 发现它或在表里填 IPMI 地址`);

  const accounts = bmcAccounts(row);
  if (!accounts.length) throw new Error(`${row.sn} 没有 IPMI 账号密码`);
  let account = accounts[0];
  let power = await exec(row.bmcIp, account.user, account.password, ["chassis", "power", "status"]);
  if (power.code !== 0 && accounts[1] && ipmiFailure(power.stderr) === "denied") {
    account = accounts[1];
    power = await exec(row.bmcIp, account.user, account.password, ["chassis", "power", "status"]);
  }
  if (power.code !== 0) {
    throw new Error(
      ipmiFailure(power.stderr) === "denied" ? `${row.sn} 的 BMC ${row.bmcIp} 不接受表里的账号密码` : `${row.sn} 的 BMC ${row.bmcIp} 没有回应`,
    );
  }

  const done: string[] = [];
  if (input.boot) {
    await setBootDevice(row.bmcIp, account.user, account.password, { device: input.boot, persistent: input.persistent, legacy: input.legacy }, exec);
    done.push(`${input.persistent ? "以后都" : "下次"}从${BOOT_DEVICES[input.boot].label}启动`);
  }
  let action = input.power;
  // 关着的机器「重启」没有意义，ipmitool 也会报错，直接开机。
  if ((action === "reset" || action === "cycle") && /power is off/i.test(power.stdout)) action = "on";
  if (action) {
    await powerControl(row.bmcIp, account.user, account.password, action, exec);
    done.push(POWER_ACTIONS[action].label);
  }
  const state = await powerStatus(row.bmcIp, account.user, account.password, exec).catch(() => "unknown" as const);
  const saved = await withLock(() => {
    const current = listServers().find((item) => item.id === row.id);
    if (!current) return row;
    const next = { ...current, power: state, ipmiLink: "up" as const, updatedAt: new Date().toISOString() };
    writeJson(serverPath(row.id), next);
    return next;
  });
  return { row: saved, message: `${row.sn}：${done.join("，")}` };
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
      writeJson(serverPath(row.id), row);
      return row;
    }
    if (!profile) {
      row.stage = "error";
      row.detail = `机器已从网卡启动，但项目里没有名为「${row.osName}」的安装设置`;
      writeJson(serverPath(row.id), row);
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
    writeJson(serverPath(row.id), row);
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
      writeJson(serverPath(row.id), row);
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
    writeJson(serverPath(row.id), row);
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
