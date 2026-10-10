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

/** 装机批次（项目）里的一行：这台机器这次怎么装。机器本身的信息在资产里，assetId 指向它。 */
export interface ServerRow {
  id: string;
  projectId: string;
  /** 旧数据没有这一项时等于 id（迁移时资产沿用了行的 id）。 */
  assetId: string;
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
  /** 装好的系统的地址。和掩码一起填了，装机最后一步把它配成业务网卡的静态 IP；批量任务也会用它登录。 */
  osAddress?: string;
  osNetmask?: string;
  osGateway?: string;
  /** 逗号分隔。 */
  osDns?: string;
  /** 业务网卡：接口名或 MAC。留空时自动挑一块不是 PXE 口的物理网卡。 */
  osNic?: string;
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

export type TaskKind = "script" | "revoke" | "inventory";
export type TaskStatus = "running" | "done";
export type TaskTargetStatus = "pending" | "running" | "ok" | "failed" | "timeout" | "unreachable";
export type TaskHostSource = "sheet" | "nic" | "fixed" | "lease" | "";

export interface TaskTarget {
  /** 资产 id。旧任务里是服务器行的 id，迁移后资产沿用了它，所以照样能用。 */
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
  /** 从装机批次里发起的任务带批次 id，从资产页发起的是空字符串。 */
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
  /** 采集硬件任务读哪几边。旧任务没有这一项。 */
  inventorySources?: InventorySource[];
  /** 采集硬件任务顺带读的 BMC 设置（overview）和 BIOS 设置，存成侧边栏 BMC、BIOS 页的「上次读到的」。 */
  inventorySettings?: BmcSettingKind[];
  createdAt: string;
  finishedAt?: string;
}

/** 硬件部件的类别。firmware 是 BIOS、BMC、CPLD 这类只有版本号的固件。 */
export type HwKind = "system" | "board" | "cpu" | "memory" | "disk" | "gpu" | "nic" | "transceiver" | "psu" | "fan" | "firmware";

/** os：SSH 进系统里用 dmidecode 等工具读；bmc：从 BMC 的 Redfish 读；snmp：网络设备用 SNMP 读。各来源的槽位名不一样，不互相比。 */
export type InventorySource = "os" | "bmc" | "snmp";

/** 经 Redfish 读、存一份上次结果的 BMC 设置：overview 是引导、定位灯、虚拟介质这些概况，bios 是全部 BIOS 设置项。 */
export type BmcSettingKind = "overview" | "bios";

/** 一个部件。slot 在同一台机器、同一来源里是稳定的位置名，比如 DIMM_P0_A0、P0、nvme0n1、GPU 的 PCI 地址。 */
export interface HwComponent {
  kind: HwKind;
  slot: string;
  model: string;
  vendor: string;
  sn: string;
  firmware: string;
  /** 各类特有的属性，比如内存的 sizeGB、CPU 的 cores。数值按数字存，比对基准时按文字比。 */
  attrs: Record<string, string | number>;
}

export type HwChangeType = "added" | "removed" | "replaced" | "changed";

/** 和同一来源的上一次采集比出的变化。replaced 是同一槽位换了序列号，changed 是同一个部件的型号、固件或属性变了。 */
export interface HwChange {
  type: HwChangeType;
  kind: HwKind;
  slot: string;
  before?: HwComponent;
  after?: HwComponent;
  /** changed 时变了的字段，例如 firmware、sizeGB。 */
  fields?: string[];
}

/** 一次采集的结果。每台机器、每个来源各留最近 30 次。 */
export interface InventorySnapshot {
  id: string;
  /** 资产 id。 */
  serverId: string;
  projectId: string;
  sn: string;
  source: InventorySource;
  at: string;
  /** os 来源是 SSH 登录的地址，bmc 来源是 BMC 地址。 */
  host: string;
  components: HwComponent[];
  /** 和上一次同来源采集比出的变化；第一次采集没有。 */
  changes?: HwChange[];
  /** 没装的工具、读不到的 Redfish 路径等，只提示不算失败。 */
  warnings: string[];
  /** GPU 和网卡的 PCIe/NVLink 拓扑，只有系统内采集有。 */
  topology?: Topology;
  /** 盘位、PCIe 插槽、网口和各自的占用情况。这个功能上线前的采集没有。 */
  ports?: HwPort[];
  /** 网络设备的端口，只有 snmp 来源有。 */
  netPorts?: NetPort[];
  /** 网络设备的系统信息，只有 snmp 来源有。 */
  system?: NetSystem;
}

export interface NetSystem {
  name: string;
  descr: string;
  objectId: string;
  /** 秒。 */
  uptime: number | null;
}

/** LLDP 看到的对端。能对上资产时带上资产 id 和编号。 */
export interface NetNeighbor {
  sysName: string;
  portId: string;
  portDesc: string;
  chassisId: string;
  assetId?: string;
  assetTag?: string;
}

/** 网络设备的一个端口。 */
export interface NetPort {
  index: number;
  name: string;
  descr: string;
  /** 端口描述（ifAlias），常写对端。 */
  alias: string;
  admin: "up" | "down" | "testing" | "";
  oper: "up" | "down" | "testing" | "unknown" | "dormant" | "notPresent" | "lowerLayerDown" | "";
  /** Mb/s。 */
  speed: number | null;
  mtu: number | null;
  inErrors: number | null;
  outErrors: number | null;
  /** 只看物理口：以太网（6）、InfiniBand（199）等。 */
  physical: boolean;
  neighbor?: NetNeighbor;
  transceiver?: { model: string; sn: string; vendor: string };
}

export type SnmpVersion = "v2c" | "v3";

export interface SnmpProfile {
  id: string;
  name: string;
  version: SnmpVersion;
  community: string;
  username: string;
  /** MD5、SHA、SHA-256 等，空表示不认证。 */
  authProto: string;
  authPass: string;
  /** DES、AES 等，空表示不加密。 */
  privProto: string;
  privPass: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicSnmpProfile = Omit<SnmpProfile, "community" | "authPass" | "privPass"> & { hasCommunity: boolean; hasAuthPass: boolean; hasPrivPass: boolean };

export type PortGroup = "drive" | "pcie" | "net";

/** 机器上的一个接口：一个盘位、一个 PCIe 插槽或一个网口。 */
export interface HwPort {
  group: PortGroup;
  /** 槽位或网口名，例如 Slot 3、ata2、ens1f0。 */
  name: string;
  /** 规格，例如 PCIe Gen5 x16、SAS/SATA 背板、U.2 NVMe。 */
  type: string;
  /** true 占用，false 空闲，null 读不出来。网口按有没有链路算。 */
  used: boolean | null;
  /** 插在上面的东西：盘或卡的型号、盘符。 */
  device: string;
  /** 网口的链路：up 有链路，down 没链路，disabled 口没启用。 */
  link?: "up" | "down" | "disabled" | "";
  speed?: string;
  ips?: string[];
  /** 网口加入的 bond 或网桥。 */
  master?: string;
  mac?: string;
  note?: string;
}

/** 一个网口上的光模块和它当时的收发光。twin-port 模块的两个口会读到同一个序列号。 */
export interface OpticsPort {
  /** 网口名，没有网口时是 RDMA 设备名。 */
  port: string;
  ports: string[];
  rdma?: string;
  pci: string;
  source: "mlxlink" | "ethtool";
  present: boolean;
  /** 读不到时的原因。 */
  error?: string;
  type?: string;
  vendor?: string;
  model?: string;
  sn?: string;
  firmware?: string;
  compliance?: string;
  cable?: string;
  wavelengthNm?: number;
  length?: string;
  temperatureC?: number;
  temperatureRange?: [number, number];
  voltageV?: number;
  /** 每条 lane 的收光、发光，dBm。 */
  rx: number[];
  tx: number[];
  /** 模块自己报的告警门限，dBm。 */
  rxRange?: [number, number];
  txRange?: [number, number];
}

/** 一台机器最近一次手动查询的收发光。 */
export interface OpticsReading {
  serverId: string;
  at: string;
  host: string;
  ports: OpticsPort[];
}

/** 拓扑图里的一个 PCIe 设备：一块 GPU，或网卡的一个 function（一个口）。 */
export interface TopoDevice {
  /** 0000:06:00.0 */
  pci: string;
  kind: "gpu" | "nic";
  /** GPU0，或者网口名。 */
  name: string;
  model: string;
  sn: string;
  numa: number | null;
  /** 根复合体，例如 pci0000:00。 */
  root: string;
  /** 从根端口往下到这个设备之前经过的桥。 */
  bridges: string[];
  netdevs: string[];
  /** RDMA 设备名，例如 mlx5_0。 */
  rdma: string[];
}

export interface Topology {
  devices: TopoDevice[];
  /** GPU 之间的 NVLink 条数，a、b 是 PCI 地址。 */
  nvlinks: { a: string; b: string; count: number }[];
  /** NUMA 节点号到 CPU 范围，例如 "0": "0-63"。 */
  numaCpus: Record<string, string>;
}

/** 基准配置的一条：这一类、这个型号（和这些属性）应该有 count 个。firmware 填了就要求版本一致。 */
export interface BaselineRule {
  kind: HwKind;
  model: string;
  count: number;
  firmware?: string;
  attrs?: Record<string, string>;
}

/** 项目的基准配置。只和同一来源的采集比，因为两边的型号写法不一样。 */
export interface Baseline {
  projectId: string;
  source: InventorySource;
  rules: BaselineRule[];
  /** 从哪台机器生成的，只用来显示。 */
  fromSn?: string;
  updatedAt: string;
}

export interface BaselineIssue {
  kind: HwKind;
  model: string;
  message: string;
}

/** 采集记录列表里的一行，不带部件明细。 */
export interface InventoryMeta {
  id: string;
  source: InventorySource;
  at: string;
  host: string;
  components: number;
  /** 和上一次比的变化数；第一次采集是 null。 */
  changes: number | null;
}

/** 服务器列表里「硬件」一列：每个来源最近一次的时间和变化数，以及按基准检查出的问题数。 */
export interface InventoryStatus {
  os?: { at: string; changes: number | null };
  bmc?: { at: string; changes: number | null };
  /** 没有基准，或者基准那个来源还没采集过时是 null。 */
  issues: number | null;
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

export type AssetType = "server" | "switch" | "pdu" | "other";

/** 生命周期：入库 → 上架 → 装机中 → 待交付 → 在用 → 维修中 → 下架 → 报废。 */
export type AssetStatus = "stock" | "racked" | "installing" | "pending" | "active" | "repair" | "offline" | "scrapped";

export interface Customer {
  id: string;
  /** 简称，用在资产编号里，例如 RS、ACME。 */
  code: string;
  name: string;
  contact: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 一台设备。BMC 和系统地址可以手填，也会在装机批次里更新时同步过来。 */
export interface Asset {
  id: string;
  /** 入库顺序号，编号规则里的 {seq} 用它，不会重复也不会变。 */
  seq: number;
  /** 按当前编号规则算出来的编号；单台手动指定了就用手动的。 */
  tag: string;
  tagOverride: string;
  type: AssetType;
  sn: string;
  vendor: string;
  model: string;
  customerId: string | null;
  /** 负责人。 */
  owner: string;
  status: AssetStatus;
  /** 位置备注：机柜之外的补充说明。 */
  location: string;
  rackId: string | null;
  /** 最下面占的那个 U（U1 在最底下）。在机柜里但没定 U 位时是 null。 */
  uStart: number | null;
  /** 占几个 U，0 表示侧挂（竖装 PDU 等），不占 U 位。 */
  uHeight: number;
  bmcMac: string;
  bmcIp: string;
  bmcUser: string;
  bmcPassword: string;
  /** BMC 恢复出厂后可能只认原账号，主账号被拒时再试它。 */
  bmcFallbackUser: string;
  bmcFallbackPassword: string;
  bootMac: string;
  /** 网络设备、PDU 的管理地址，SNMP 走它。 */
  mgmtIp: string;
  snmpProfileId: string | null;
  osAddress: string;
  osNetmask: string;
  hostname: string;
  purchaseSupplier: string;
  purchaseOrder: string;
  /** YYYY-MM-DD，下同。 */
  purchaseDate: string;
  purchasePrice: string;
  warrantyVendor: string;
  warrantyLevel: string;
  warrantyStart: string;
  warrantyEnd: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicAsset = Omit<Asset, "bmcPassword" | "bmcFallbackPassword"> & { hasBmcPassword: boolean; hasBmcFallback: boolean };

export interface AssetEvent {
  id: number;
  assetId: string;
  at: string;
  actor: string;
  /** status 状态变化，edit 改了资料，install 装机，hardware 硬件变化，task 任务，note 备注。 */
  kind: string;
  text: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  ip: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  detail: string;
  ok: boolean;
}

export interface TagSettings {
  /** 例如 RS-{type}-{seq:5}。可用 {type} {customer} {seq} {seq:N} {year} {sn}。 */
  template: string;
  /** 没有归属客户时 {customer} 填什么。 */
  noCustomer: string;
  typeCodes: Record<AssetType, string>;
}

/** 数据中心：最上面一层，下面是机房、机柜、设备。 */
export interface Datacenter {
  id: string;
  code: string;
  name: string;
  address: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 机房：数据中心里的一个房间（模块）。代码在所有数据中心里唯一。 */
export interface Site {
  id: string;
  datacenterId: string;
  code: string;
  name: string;
  /** 在数据中心里的位置，例如 3 楼。 */
  address: string;
  note: string;
  /** 平面图的宽、深（格子数，一格一个机柜位）。0 是没设，不画外墙。 */
  floorW: number;
  floorH: number;
  createdAt: string;
  updatedAt: string;
}

export interface Rack {
  id: string;
  siteId: string;
  /** 机柜号，在同一个机房里唯一，例如 A01。 */
  name: string;
  /** 列或排，例如 A 列。 */
  rowLabel: string;
  heightU: number;
  /** 额定功率，自由填写，例如 12kW。 */
  powerKw: string;
  note: string;
  /** 俯视图里的格子位置，没摆过是 null（按列/排自动排）。 */
  posX: number | null;
  posY: number | null;
  /** 正面朝哪边：up 朝上、down 朝下，空表示没设。 */
  facing: RackFacing;
  /** 不可用（坏了、预留）：不能往里放设备，俯视图里画成斜纹。 */
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RackFacing = "" | "up" | "down" | "left" | "right";

/** 机房平面上不是机柜的东西：柱子、空调、配电柜、预留空位等。 */
export type FloorItemKind = "door" | "pillar" | "ac" | "power" | "switch" | "ups" | "fire" | "blocked" | "other";

/** 开在哪面外墙上（门、墙上的开关）；空是放在机房里面占格子。 */
export type FloorWall = "" | "top" | "bottom" | "left" | "right";

export interface FloorItem {
  id: string;
  siteId: string;
  kind: FloorItemKind;
  /** 显示的名字，空就用类型名。 */
  label: string;
  x: number;
  y: number;
  /** 占几格宽、几格高。开在墙上的（side 不空）w 是沿墙的长度，h 不用。 */
  w: number;
  h: number;
  /** 开在哪面外墙上。不空时 x（上下墙）或 y（左右墙）是沿墙从左/上数的偏移，不占机房里的格子。 */
  side: FloorWall;
}

/** 备件类型：硬件采集的部件类别，加上风扇、线缆和其他。 */
export type PartKind = "cpu" | "memory" | "disk" | "gpu" | "nic" | "transceiver" | "psu" | "board" | "fan" | "cable" | "other";

/** 在库 → 已装机 → 已拆下 / 待返修 → 返修中 → 在库或报废。 */
export type PartStatus = "stock" | "installed" | "removed" | "faulty" | "rma" | "scrapped";

export interface Part {
  id: string;
  kind: PartKind;
  model: string;
  vendor: string;
  /** 没有序列号的（线缆等）是空字符串；有的话全局唯一。 */
  sn: string;
  status: PartStatus;
  /** 存放的机房和库位；装在机器上时看 assetId。 */
  siteId: string | null;
  bin: string;
  assetId: string | null;
  /** 装在机器上的槽位，例如 GPU 的 PCI 地址、DIMM_P0_A0。 */
  slot: string;
  supplier: string;
  purchaseOrder: string;
  warrantyEnd: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartEvent {
  id: number;
  partId: string;
  at: string;
  actor: string;
  kind: string;
  text: string;
  ticketId: string;
}

export type TicketKind = "fault" | "repair" | "change" | "other";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "processing" | "waiting" | "resolved" | "closed";

export interface Ticket {
  id: string;
  seq: number;
  /** WO-2026-0001，年份是建单那年。 */
  no: string;
  assetId: string | null;
  title: string;
  kind: TicketKind;
  priority: TicketPriority;
  status: TicketStatus;
  assignee: string;
  reporter: string;
  description: string;
  /** 厂商那边的工单号或 RMA 号。 */
  vendorCase: string;
  /** 建单时把资产改成「维修中」之前的状态，解决后改回去。没改过是空的。 */
  prevAssetStatus: AssetStatus | "";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
  closedAt: string;
}

export interface TicketLog {
  id: number;
  ticketId: string;
  at: string;
  actor: string;
  /** comment 评论，status 状态，edit 改了字段，replace 换件，create 建单。 */
  kind: string;
  text: string;
}

export type AlertSeverity = "warning" | "critical";
/** active 告警中，acked 已确认（还在但有人知道了），resolved 已恢复或已处理。 */
export type AlertStatus = "active" | "acked" | "resolved";
/** sensor BMC 传感器，sel BMC 事件日志，bmc BMC 连不上，gpu 显卡，xid 驱动报的 Xid，disk 硬盘。 */
export type AlertSource = "sensor" | "sel" | "bmc" | "gpu" | "xid" | "disk" | "snmp" | "port";

export interface Alert {
  id: number;
  assetId: string;
  /** 去重用：同一台、同一个 key 没恢复前只有一条。 */
  key: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  detail: string;
  status: AlertStatus;
  /** 事件类（SEL、Xid）不会自己恢复，要人处理；状态类条件消失就自动恢复。 */
  sticky: boolean;
  count: number;
  firstAt: string;
  lastAt: string;
  ackedBy: string;
  ackedAt: string;
  resolvedBy: string;
  resolvedAt: string;
  ticketId: string;
}

/** 一个传感器的读数。status 是 ipmitool 给的：ok、nc、cr、nr、ns 等。 */
export interface SensorReading {
  name: string;
  status: string;
  reading: string;
  severity: AlertSeverity | null;
}

export interface SelEntry {
  id: string;
  at: string;
  sensor: string;
  event: string;
  direction: string;
  severity: AlertSeverity | "info";
}

export interface GpuHealth {
  index: string;
  bus: string;
  serial: string;
  temperature: number | null;
  eccUncorrected: number | null;
}

export interface DiskHealth {
  name: string;
  /** PASSED、FAILED、OK 或读不到时的原文。 */
  health: string;
  ok: boolean;
}

export interface MonitorState {
  assetId: string;
  bmcAt: string;
  bmcOk: boolean;
  bmcError: string;
  bmcFailures: number;
  sensors: SensorReading[];
  selLast: string;
  selRecent: SelEntry[];
  osAt: string;
  /** 上次系统内检查成功的时间；Xid 从这里往后查，失败的那几次不算。 */
  osOkAt: string;
  osOk: boolean;
  osError: string;
  gpus: GpuHealth[];
  disks: DiskHealth[];
  /** 网络设备上次读到的端口状态和错包数，用来比出掉线和错包增长。 */
  ports: { name: string; admin: string; oper: string; inErrors: number | null; outErrors: number | null; neighbor: string }[];
}

export interface MonitorSettings {
  enabled: boolean;
  /** 读 BMC 传感器和事件日志的间隔。 */
  bmcIntervalMin: number;
  /** SSH 进系统查 GPU 和硬盘的间隔，0 表示不查。 */
  osIntervalMin: number;
  /** 哪些状态的资产要监控。 */
  statuses: AssetStatus[];
  gpuTempWarn: number;
  /** 不报的传感器名，逗号分开，可以用 * 通配。 */
  ignoreSensors: string;
  /** BMC 连续几次连不上才报。 */
  bmcFailuresToAlert: number;
  /** 经 Redfish SSE 长连着收 BMC 的实时事件。 */
  redfishEvents: boolean;
}
