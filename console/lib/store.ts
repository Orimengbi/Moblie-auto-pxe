import fs from "node:fs";
import path from "node:path";
import { renderBootIpxe, renderDnsmasq } from "./dnsmasq.ts";
import {
  applyHostname,
  assertAddressRanges,
  assertDiskName,
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
import {
  dataDir,
  diagDir,
  dnsmasqConfPath,
  ensureDataDirs,
  imageDir,
  incomingDir,
  ipmiPath,
  leasePath,
  machinePath,
  profilePath,
  projectPath,
  reportPath,
  scriptBodyPath,
  scriptMetaPath,
  statePath,
  tftpDir,
} from "./paths.ts";
import {
  DEFAULT_STATE,
  type ApplianceState,
  type BuiltinDiag,
  type DiagScript,
  type DiskPolicy,
  type ImageRecord,
  type InstalledNetwork,
  type IpmiSetting,
  type Machine,
  type MachineAction,
  type NetworkConfig,
  type Profile,
  type Project,
  type ProjectDhcp,
  type ProjectFixed,
  type Report,
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

function dhcpRanges(network: NetworkConfig, projects: Project[]) {
  return [
    {
      label: "未归类机器的临时地址池",
      start: network.dhcpStart,
      end: network.dhcpEnd,
      netmask: network.netmask,
      gateway: network.gateway,
    },
    ...projects.map((project) => ({
      label: `项目「${project.name}」`,
      start: project.dhcp.start,
      end: project.dhcp.end,
      netmask: project.dhcp.netmask,
      gateway: project.dhcp.gateway,
    })),
  ];
}

export function syncBootFiles(network: NetworkConfig): void {
  ensureDataDirs();
  fs.writeFileSync(dnsmasqConfPath(), renderDnsmasq(network, listProjects(), listMachines()));
  fs.writeFileSync(path.join(tftpDir(), "boot.ipxe"), renderBootIpxe(network.serverIp));
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
    };
    assertIpv4(network.dns, "DNS");
    assertAddressRanges(network.serverIp, dhcpRanges(network, listProjects()));
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
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getImage(id: string): ImageRecord | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  return readJson<ImageRecord>(path.join(imageDir(id), "meta.json"));
}

export function writeImage(record: ImageRecord): void {
  writeJson(path.join(imageDir(record.id), "meta.json"), record);
}

export function listIncoming(): string[] {
  ensureDataDirs();
  return fs
    .readdirSync(incomingDir())
    .filter((name) => name.toLowerCase().endsWith(".iso") && !name.startsWith("."))
    .sort();
}

export interface NewImageInput {
  name: string;
  filename: string;
}

export async function createImageFromIncoming(input: NewImageInput): Promise<ImageRecord> {
  return withLock(() => {
    const filename = path.basename(input.filename);
    if (!filename.toLowerCase().endsWith(".iso")) throw new Error("只能导入 .iso 文件");
    const source = path.join(incomingDir(), filename);
    if (!fs.existsSync(source)) throw new Error("incoming 目录里没有这个 ISO");
    const name = input.name.trim() || filename.replace(/\.iso$/i, "");
    if (name.length < 2 || name.length > 80) throw new Error("镜像名称需要 2 到 80 个字符");
    const id = crypto.randomUUID();
    const dir = imageDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(source, path.join(dir, "source.iso"));
    const record: ImageRecord = {
      id,
      name,
      family: "ubuntu",
      version: "",
      filename,
      status: "extracting",
      hasTree: false,
      createdAt: new Date().toISOString(),
    };
    writeImage(record);
    return record;
  });
}

export async function saveUploadedIso(filename: string, bytes: Buffer, name: string): Promise<ImageRecord> {
  const safe = path.basename(filename);
  if (!safe.toLowerCase().endsWith(".iso")) throw new Error("只能上传 .iso 文件");
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
  packages: string[];
  postScript?: string;
  locale?: string;
  timezone?: string;
}

function normalizeProfileInput(input: ProfileInput, existing?: Profile): Omit<Profile, "id" | "createdAt" | "updatedAt" | "passwordHash"> & { passwordHash: string } {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new Error("配置名称需要 2 到 80 个字符");
  const image = getImage(input.imageId);
  if (!image || image.status !== "ready") throw new Error("请选择一个已经抽取完成的镜像");
  const hostnamePattern = input.hostnamePattern.trim();
  applyHostname(hostnamePattern, "00:11:22:33:44:55");
  const diskPolicy = input.diskPolicy;
  if (!["largest", "smallest", "named"].includes(diskPolicy)) throw new Error("磁盘策略不合法");
  const diskName = diskPolicy === "named" ? assertDiskName(input.diskName || "") : input.diskName?.trim() || "sda";
  const password = input.password?.trim();
  const passwordHash = password ? hashPassword(password) : existing?.passwordHash;
  if (!passwordHash) throw new Error("请设置安装密码");
  return {
    name,
    imageId: image.id,
    hostnamePattern,
    username: assertUsername(input.username),
    passwordHash,
    diskPolicy,
    diskName,
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
    const bound = listMachines().filter((machine) => machine.profileId === id);
    if (bound.length) throw new Error("还有机器绑定了这个配置");
    fs.rmSync(profilePath(id), { force: true });
  });
}

function assertDnsList(value: string, label: string): string {
  const items = value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  if (!items.length) throw new Error(`${label}不能为空`);
  return items.map((item) => assertIpv4(item, label)).join(",");
}

function normalizeDhcp(input: ProjectDhcp, label: string): ProjectDhcp {
  return {
    start: assertIpv4(input.start, `${label}起点`),
    end: assertIpv4(input.end, `${label}终点`),
    netmask: assertIpv4(input.netmask, `${label}掩码`),
    gateway: assertIpv4(input.gateway, `${label}网关`),
    dns: assertDnsList(input.dns, `${label}DNS`).split(",")[0],
    leaseHours: assertLeaseHours(Number(input.leaseHours)),
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

export function listProjects(): Project[] {
  ensureDataDirs();
  return listJson<Project>(path.join(dataDir(), "projects")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): Project | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
  return readJson<Project>(projectPath(id));
}

export interface ProjectInput {
  name: string;
  note?: string;
  dhcp: ProjectDhcp;
  fixed: ProjectFixed;
}

function normalizeProject(input: ProjectInput, existingId?: string): Omit<Project, "id" | "createdAt" | "updatedAt"> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new Error("项目名称需要 2 到 80 个字符");
  const dhcp = normalizeDhcp(input.dhcp, "临时地址池");
  const fixed = normalizeFixed(input.fixed);
  if (fixed.mode === "static") {
    netmaskToPrefix(fixed.netmask);
    if (!sameSubnet(fixed.gateway, fixed.gateway, fixed.netmask)) {
      throw new Error("固定网络的网关不合法");
    }
  }
  const network = getState().network;
  const others = listProjects().filter((project) => project.id !== existingId);
  assertAddressRanges(network.serverIp, dhcpRanges(network, [...others, { id: existingId || "draft", name, note: "", dhcp, fixed, createdAt: "", updatedAt: "" }]));
  if (existingId && fixed.mode === "static") {
    for (const machine of listMachines()) {
      if (machine.projectId !== existingId || !machine.fixedIp) continue;
      if (!sameSubnet(machine.fixedIp, fixed.gateway, fixed.netmask)) {
        throw new Error(`机器 ${machine.mac} 的固定 IP 不在新的固定网络里`);
      }
    }
  }
  return { name, note: (input.note || "").slice(0, 200), dhcp, fixed };
}

export async function createProject(input: ProjectInput): Promise<Project> {
  return withLock(() => {
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      ...normalizeProject(input),
      createdAt: now,
      updatedAt: now,
    };
    writeJson(projectPath(project.id), project);
    syncBootFiles(getState().network);
    return project;
  });
}

export async function updateProject(id: string, input: ProjectInput): Promise<Project> {
  return withLock(() => {
    const existing = getProject(id);
    if (!existing) throw new Error("项目不存在");
    const project: Project = {
      ...existing,
      ...normalizeProject(input, existing.id),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    writeJson(projectPath(project.id), project);
    syncBootFiles(getState().network);
    return project;
  });
}

export async function deleteProject(id: string): Promise<void> {
  return withLock(() => {
    if (!getProject(id)) throw new Error("项目不存在");
    const used = listMachines().filter((machine) => machine.projectId === id);
    if (used.length) throw new Error(`还有机器属于这个项目：${used.map((item) => item.mac).join("、")}`);
    fs.rmSync(projectPath(id), { force: true });
    syncBootFiles(getState().network);
  });
}

export function installedNetworkForMac(mac: string): InstalledNetwork | null {
  let machine: Machine | null = null;
  try {
    machine = getMachine(mac);
  } catch {
    return null;
  }
  if (!machine?.projectId) return null;
  const project = getProject(machine.projectId);
  if (!project || project.fixed.mode !== "static") return null;
  if (!machine.fixedIp) {
    throw new Error(`机器 ${machine.mac} 属于项目「${project.name}」，装完要使用固定地址，但还没有填写固定 IP`);
  }
  return {
    address: machine.fixedIp,
    netmask: project.fixed.netmask,
    prefix: netmaskToPrefix(project.fixed.netmask),
    gateway: project.fixed.gateway,
    dns: project.fixed.dns.split(",").filter(Boolean),
  };
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
  const duplicate = listIpmi().find((item) => item.sn === sn && item.id !== existingId);
  if (duplicate) throw new Error(`序列号 ${sn} 已经有 IPMI 网络设置`);
  if (input.mode !== "static" && input.mode !== "dhcp") throw new Error("IPMI 地址方式只能是固定或 DHCP");
  let projectId = input.projectId || "";
  if (projectId) {
    const project = getProject(projectId);
    if (!project) throw new Error("项目不存在");
    projectId = project.id;
  }
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
  const normalized = normalizeSn(sn);
  return listIpmi().find((item) => item.sn === normalized) || null;
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
    if (!["menu", "install", "diag"].includes(input.action)) throw new Error("绑定动作不合法");
    let profileId = input.profileId || "";
    if (input.action === "install") {
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
      if (project.fixed.mode === "static") {
        fixedIp = assertIpv4(input.fixedIp || "", "固定 IP");
        if (!sameSubnet(fixedIp, project.fixed.gateway, project.fixed.netmask)) {
          throw new Error(`固定 IP 必须和项目网关 ${project.fixed.gateway} 在同一个子网`);
        }
        const duplicate = listMachines().find((item) => item.mac !== mac && item.fixedIp === fixedIp);
        if (duplicate) throw new Error(`固定 IP ${fixedIp} 已经分给 ${duplicate.mac}`);
      }
    }
    const existing = getMachine(mac);
    const machine: Machine = {
      mac,
      action: input.action,
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

export function readLeasesText(): string {
  if (!fs.existsSync(leasePath())) return "";
  return fs.readFileSync(leasePath(), "utf8");
}

export function publicProfile(profile: Profile): Omit<Profile, "passwordHash"> & { hasPassword: boolean } {
  const { passwordHash, ...rest } = profile;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}
