export type Family = "ubuntu" | "debian" | "rocky" | "alma";

export type DiskPolicy = "largest" | "smallest" | "named";

export type ImageStatus = "extracting" | "ready" | "error";

export type MachineAction = "menu" | "install" | "diag";

export interface ImageRecord {
  id: string;
  name: string;
  family: Family;
  version: string;
  filename: string;
  status: ImageStatus;
  error?: string;
  kernelFile?: string;
  initrdFile?: string;
  hasTree: boolean;
  createdAt: string;
}

export interface Profile {
  id: string;
  name: string;
  imageId: string;
  hostnamePattern: string;
  username: string;
  passwordHash: string;
  diskPolicy: DiskPolicy;
  diskName: string;
  packages: string[];
  postScript: string;
  locale: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface Machine {
  mac: string;
  action: MachineAction;
  profileId?: string;
  projectId?: string;
  fixedIp?: string;
  scriptIds: string[];
  note: string;
  lastSeen?: string;
}

export interface ProjectDhcp {
  start: string;
  end: string;
  netmask: string;
  gateway: string;
  dns: string;
  leaseHours: number;
}

export interface ProjectFixed {
  mode: "static" | "dhcp";
  netmask: string;
  gateway: string;
  dns: string;
}

export interface Project {
  id: string;
  name: string;
  note: string;
  dhcp: ProjectDhcp;
  fixed: ProjectFixed;
  createdAt: string;
  updatedAt: string;
}

export interface InstalledNetwork {
  address: string;
  netmask: string;
  prefix: number;
  gateway: string;
  dns: string[];
}

export interface IpmiSetting {
  id: string;
  sn: string;
  projectId?: string;
  mode: "static" | "dhcp";
  address?: string;
  netmask: string;
  gateway: string;
  channel: number;
  vlanId?: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagScript {
  id: string;
  name: string;
  filename: string;
  enabled: boolean;
  createdAt: string;
}

export interface DiagCheck {
  name: string;
  ok: boolean;
  summary: string;
  detail?: string;
}

export interface ScriptResult {
  id: string;
  name: string;
  exitCode: number | null;
  timedOut: boolean;
  blocked: boolean;
  output: string;
}

export interface Report {
  id: string;
  mac: string;
  startedAt: string;
  finishedAt: string;
  checks: DiagCheck[];
  scripts: ScriptResult[];
  mountViolation: boolean;
  ok: boolean;
}

export interface NetworkConfig {
  pxeInterface: string;
  serverIp: string;
  dhcpStart: string;
  dhcpEnd: string;
  netmask: string;
  gateway: string;
  dns: string;
  menuTimeoutSec: number;
}

export interface BuiltinDiag {
  cpu: boolean;
  memory: boolean;
  nic: boolean;
  thermal: boolean;
  disk: boolean;
  firmware: boolean;
}

export interface ApplianceState {
  network: NetworkConfig;
  builtinDiag: BuiltinDiag;
}

export const FAMILY_LABEL: Record<Family, string> = {
  ubuntu: "Ubuntu",
  debian: "Debian",
  rocky: "Rocky Linux",
  alma: "AlmaLinux",
};

export const DISK_LABEL: Record<DiskPolicy, string> = {
  largest: "最大的磁盘",
  smallest: "最小的磁盘",
  named: "指定盘符",
};

export const DEFAULT_STATE: ApplianceState = {
  network: {
    pxeInterface: "eth1",
    serverIp: "192.168.77.1",
    dhcpStart: "192.168.77.50",
    dhcpEnd: "192.168.77.200",
    netmask: "255.255.255.0",
    gateway: "192.168.77.1",
    dns: "192.168.77.1",
    menuTimeoutSec: 15,
  },
  builtinDiag: {
    cpu: true,
    memory: true,
    nic: true,
    thermal: true,
    disk: true,
    firmware: true,
  },
};
