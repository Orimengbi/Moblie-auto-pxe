export type Family = "ubuntu" | "debian" | "rocky" | "alma";

export type DiskPolicy = "largest" | "smallest" | "named" | "custom";
export type DiskPick = "largest" | "smallest" | "named";
/** 整盘镜像的启动方式：写到硬盘，或者整个系统放进内存跑、不碰硬盘。 */
export type DiskMode = "deploy" | "live";
export type PartitionFs = "ext4" | "xfs" | "fat32" | "swap";

export interface DiskPartition {
  mount: string;
  size: string;
  fs: PartitionFs;
}

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
  /** ISO 的字节数。 */
  size?: number;
  /** 不填就是安装 ISO。disk 是装好系统的整盘镜像，可以写盘也可以在内存里运行。 */
  kind?: ImageKind;
  disk?: DiskImageInfo;
  createdAt: string;
}

export type ImageKind = "iso" | "disk";

/** 整盘镜像拆开后的布局，写盘脚本按这个写。 */
export interface DiskImageInfo {
  /** 根分区之前的字节数：分区表和 EFI 分区，在 head.img.zst 里。 */
  headBytes: number;
  rootPartition: number;
  espPartition?: number;
  /** 收缩后的根分区字节数，在 root.img.zst 里。 */
  rootBytes: number;
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
  diskPick?: DiskPick;
  partitions?: DiskPartition[];
  /** 只对整盘镜像有用。绑定的机器菜单超时后按这个方式启动；旧配置没有这一项，按写盘处理。 */
  diskMode?: DiskMode;
  packages: string[];
  postScript: string;
  locale: string;
  timezone: string;
  projectId: string;
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
  /** 客户端回来下载系统时访问的本机地址。对上多网口里的一块即可。 */
  serverIp?: string;
  vlan?: number;
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
  enabled: boolean;
  dhcp: ProjectDhcp | null;
  fixed: ProjectFixed | null;
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

export type PowerState = "on" | "off" | "unknown";

export interface MachineFact {
  id: string;
  projectId: string;
  sn: string;
  mac?: string;
  ipmiAddress?: string;
  biosVersion?: string;
  bmcVersion?: string;
  osVersion?: string;
  power: PowerState;
  updatedAt: string;
}

export type ServerStage = "waiting" | "ready" | "installing" | "error";
/** denied：BMC 有回应，但拒绝了表里的账号或密码。 */
export type IpmiLink = "unknown" | "up" | "down" | "denied";
export type IpSource = "unknown" | "dhcp" | "static";
export type InstallState = "no" | "installing" | "yes";

export interface ServerRow {
  id: string;
  projectId: string;
  sn: string;
  ipmiMac: string;
  originalUser: string;
  originalPassword: string;
  targetUser: string;
  targetPassword: string;
  osName: string;
  customization: string;
  ipmiAddress: string;
  ipmiNetmask: string;
  ipmiGateway: string;
  ipmiVlan?: number;
  networkApplied: boolean;
  bmcIp?: string;
  bootMac?: string;
  /** 装好的系统的地址，批量任务优先用它登录。不填就查网卡规划和 DHCP 租约。 */
  osAddress?: string;
  passwordChanged: boolean;
  canApply: boolean;
  ipmiLink: IpmiLink;
  ipSource: IpSource;
  power: PowerState;
  installed: InstallState;
  stage: ServerStage;
  detail: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerImportReport {
  projectId: string;
  at: string;
  rows: number;
  servers: number;
  errors: { row: number; message: string }[];
}

export interface NicPlan {
  id: string;
  projectId: string;
  sn: string;
  /** 这块网卡自己的 MAC。装完后按它找到接口。 */
  mac?: string;
  /** 系统里的接口名，例如 ens1f0。没有 MAC 时按这个名字匹配。 */
  iface?: string;
  /** 只用于辨认，例如业务口、存储口。 */
  label?: string;
  hostname?: string;
  address: string;
  netmask: string;
  gateway: string;
  dns: string;
  note: string;
  createdAt: string;
  updatedAt: string;
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
  httpPort: number;
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

export const DISK_MODE_LABEL: Record<DiskMode, string> = {
  deploy: "落盘部署",
  live: "内存运行",
};

export const DISK_LABEL: Record<DiskPolicy, string> = {
  largest: "最大的磁盘",
  smallest: "最小的磁盘",
  named: "指定盘符",
  custom: "自定义分区",
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
    httpPort: 80,
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

export type TaskKind = "script" | "revoke";
export type TaskStatus = "running" | "done";
export type TaskTargetStatus = "pending" | "running" | "ok" | "failed" | "timeout" | "unreachable";
export type TaskHostSource = "sheet" | "nic" | "fixed" | "lease" | "";

export interface TaskTarget {
  serverId: string;
  sn: string;
  host: string;
  hostSource: TaskHostSource;
  status: TaskTargetStatus;
  exitCode: number | null;
  output: string;
  startedAt?: string;
  finishedAt?: string;
}

/** 装完系统后，控制台用自己的 SSH 密钥对一批机器执行同一段脚本。 */
export interface RemoteTask {
  id: string;
  projectId: string;
  kind: TaskKind;
  name: string;
  script: string;
  fileIds: string[];
  concurrency: number;
  timeoutSec: number;
  status: TaskStatus;
  runnerPid?: number;
  targets: TaskTarget[];
  createdAt: string;
  finishedAt?: string;
}

/** 上传给批量任务用的文件，例如驱动包。执行前用 scp 推到目标机。 */
export interface RemoteFile {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

/** 右上角任务列表里的一条批量任务，只带进度不带输出。 */
export interface TaskSummary {
  id: string;
  projectId: string;
  projectName: string;
  kind: TaskKind;
  name: string;
  status: TaskStatus;
  total: number;
  ok: number;
  failed: number;
  createdAt: string;
  finishedAt?: string;
}

export interface TaskFeed {
  tasks: TaskSummary[];
  extracting: { id: string; name: string }[];
  /** 服务器上没传完的镜像上传会话。 */
  uploads: { id: string; filename: string; name: string; size: number; offset: number; fingerprint: string; updatedAt: string }[];
}
