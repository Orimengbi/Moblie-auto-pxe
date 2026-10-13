/** 固件库的类型和标签。页面也要用，这里不能引 Node 模块。 */

export type FirmwareKind = "bios" | "bmc" | "cpld" | "hgx" | "nic" | "other";

export const FIRMWARE_KIND_LABEL: Record<FirmwareKind, string> = {
  bios: "BIOS",
  bmc: "BMC",
  cpld: "CPLD",
  hgx: "HGX / GPU 底板",
  nic: "网卡",
  other: "其他",
};

/** 包里找到的一个可刷写的镜像。 */
export interface FirmwareImage {
  /** 包内相对路径；单个文件上传时就是文件名。 */
  path: string;
  size: number;
  /** rbu 技嘉 BMC 刷 BIOS 用；fwpkg NVIDIA PLDM 包；rom/bin/ima 原始镜像；tool 刷写程序。 */
  type: "rbu" | "fwpkg" | "rom" | "bin" | "ima" | "tool";
  note: string;
}

export interface FirmwareComponent {
  name: string;
  version: string;
  /** 机器固件清单（Redfish FirmwareInventory）里对应项的 Id，正则，如 ^HGX_FW_GPU_\d+$。没有就没法跟机器比。 */
  inventory?: string;
  /** 板卡 SKU，如 GPU 的 PG540_SKU216，用来认适用的机器。 */
  sku?: string;
}

export interface FirmwareChecksum {
  /** 发布说明里写的。 */
  expected: string;
  /** 算出来跟它一样的那个文件；都不一样时是空。 */
  file: string;
  ok: boolean;
}

/** 自动识别出来的几项，人改过以后还留着对照。 */
export interface FirmwareDetected {
  vendor: string;
  kind: FirmwareKind;
  version: string;
  models: string[];
}

export interface FirmwarePackage {
  id: string;
  fileName: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
  vendor: string;
  kind: FirmwareKind;
  version: string;
  /** 适用的整机或主板型号。 */
  models: string[];
  buildDate: string;
  checksum: FirmwareChecksum | null;
  images: FirmwareImage[];
  /** PLDM 包（fwpkg）里各部件的版本。 */
  components: FirmwareComponent[];
  /** 发布说明里这一版改了什么。 */
  changes: string;
  /** 怎么刷：从包里有什么推出来的说明。 */
  method: string;
  warnings: string[];
  detected: FirmwareDetected;
  /** 人改过厂商、类型、版本或型号。 */
  edited: boolean;
  note: string;
}

/** 机群里一个版本和固件包版本的关系。 */
export type VersionRelation = "same" | "older" | "newer" | "unknown";

export interface FleetVersionCount {
  version: string;
  count: number;
  relation: VersionRelation;
}

/** 一个固件包在机群里能用到哪些机器、它们现在是什么版本。 */
export interface FirmwareFleet {
  /** 型号对得上的服务器台数。 */
  matched: number;
  /** 没读过固件版本、不知道现在是几版的。 */
  unread: number;
  /** 比包旧、可以升级的台数。 */
  upgradable: number;
  versions: FleetVersionCount[];
  /** 这类固件对应机器固件清单里的哪一项，如 BIOS、BMCImage1；空表示没法对比。 */
  inventoryId: string;
  /** 适用型号里机群真有的那几个。 */
  models: string[];
}

export interface FirmwareFleetMachine {
  id: string;
  tag: string;
  sn: string;
  hostname: string;
  bmcIp: string;
  version: string;
  relation: VersionRelation | "unread";
}

export type FirmwarePackageView = FirmwarePackage & { fleet: FirmwareFleet };

export const RELATION_LABEL: Record<VersionRelation | "unread", string> = {
  same: "已是这版",
  older: "比包旧",
  newer: "比包新",
  unknown: "比不出",
  unread: "没读过",
};

/** 一个固件包给这台机器用时：能推哪些镜像、默认推哪个、带什么参数，型号对不对得上。 */
export interface FirmwareChoice {
  id: string;
  fileName: string;
  vendor: string;
  kind: FirmwareKind;
  version: string;
  models: string[];
  /** 这台机器的型号在适用型号里（含型号字典别名）。 */
  fits: boolean;
  /** 这台上次读到的这类固件版本，没读过或没法比是空。 */
  current: string;
  images: { path: string; size: number; type: FirmwareImage["type"] }[];
  image: string;
  targets: string[];
  oem: Record<string, unknown>;
  prepareHmc: boolean;
}

/** 从固件库推给 BMC 的一次刷写，控制台后台跑，页面看进度。 */
export interface FirmwarePushJob {
  assetId: string;
  packageId: string;
  fileName: string;
  kind: string;
  version: string;
  image: string;
  targets: string[];
  oem: Record<string, unknown>;
  user: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
  /** prepare 腾内存，upload 上传，verify 传完等 BMC 校验，flash BMC 在刷，done 完成，failed 失败。 */
  stage: "prepare" | "upload" | "verify" | "flash" | "done" | "failed";
  /** 上传了多少字节、一共多少。 */
  sent: number;
  total: number;
  /** BMC 的刷写任务。 */
  taskPath: string;
  taskState: string;
  percent: number | null;
  /** BMC 自己报的升级阶段和百分比（AMI：Flashing / Power soft reset…，"40% done."）；任务里没有百分比时看这个。 */
  bmcStatus?: string;
  bmcPercent?: number | null;
  /** 进到刷写的时间，页面显示刷了多久。 */
  flashAt?: string;
  messages: string[];
  error: string;
  /** 右上角「任务」里对应的那条（固件升级）。 */
  taskId?: string;
}
