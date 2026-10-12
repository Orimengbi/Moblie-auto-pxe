/**
 * 角色和权限点。角色是一组权限点，管理员可以自己建、改；内置四个：只读、值班、工程师、管理员。
 * 看页面、导出表格、下载日志谁都能做，不算权限点。管理员固定拥有全部权限，不能改。
 * 页面和中间件都用这个文件（不依赖 Node 模块）；角色存在哪、怎么改在 auth.ts。
 */

export const PERMISSION_GROUPS = ["运维", "服务器操作", "装机", "资产和机房", "系统"] as const;

export const PERMISSIONS = [
  { key: "alerts", group: "运维", label: "处理告警", hint: "确认、处理完、转工单" },
  { key: "tickets", group: "运维", label: "工单", hint: "新建、改、评论、换件、改状态" },
  { key: "parts.status", group: "运维", label: "备件出入库", hint: "领用、归还、报废这类状态变更" },
  { key: "power", group: "服务器操作", label: "电源和引导", hint: "开关机、重启、设下次引导" },
  { key: "console", group: "服务器操作", label: "远程控制台", hint: "" },
  { key: "media", group: "服务器操作", label: "虚拟介质", hint: "挂载、弹出 ISO" },
  { key: "refresh", group: "服务器操作", label: "立即刷新", hint: "传感器、监控、SNMP、收发光马上读一次" },
  { key: "logs.collect", group: "服务器操作", label: "批量收集日志", hint: "单台下载日志不用这一项" },
  { key: "scripts", group: "服务器操作", label: "执行脚本", hint: "批量跑脚本、交付清理" },
  { key: "inventory", group: "服务器操作", label: "采集硬件", hint: "" },
  { key: "bmc.settings", group: "服务器操作", label: "BMC 设置", hint: "BMC 网络、时钟、引导顺序、资产标签，重启 BMC" },
  { key: "bios", group: "服务器操作", label: "BIOS 设置", hint: "" },
  { key: "firmware", group: "服务器操作", label: "固件", hint: "升级固件，管理固件库" },
  { key: "bmc.users", group: "服务器操作", label: "BMC 用户", hint: "单台和批量管理 IPMI 用户" },
  { key: "logs.clear", group: "服务器操作", label: "清空 BMC 日志", hint: "" },
  { key: "install", group: "装机", label: "PXE 装机", hint: "装机批次、导入服务器、重装、硬件基准" },
  { key: "images", group: "装机", label: "镜像和配置模板", hint: "上传镜像，改配置模板" },
  { key: "assets.edit", group: "资产和机房", label: "录入和编辑资产", hint: "入库、Excel 导入、改资产、网络设备基线" },
  { key: "dc.edit", group: "资产和机房", label: "机房、机柜和客户", hint: "新建和修改" },
  { key: "parts.edit", group: "资产和机房", label: "录入和编辑备件", hint: "" },
  { key: "catalog", group: "资产和机房", label: "型号字典和备件替换组", hint: "" },
  { key: "files", group: "资产和机房", label: "上传文件", hint: "文件库" },
  { key: "delete", group: "系统", label: "删除", hint: "删除资产、机房、机柜、客户、备件、镜像、模板、装机批次和文件" },
  { key: "settings", group: "系统", label: "系统设置", hint: "显示、监控、SSH 跳板机、SNMP 模板、资产编号规则" },
  { key: "users", group: "系统", label: "用户、角色和审计", hint: "管理所有账号，看审计日志" },
] as const satisfies readonly { key: string; group: (typeof PERMISSION_GROUPS)[number]; label: string; hint: string }[];

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((item) => item.key);

export function isPermission(value: unknown): value is Permission {
  return ALL_PERMISSIONS.includes(value as Permission);
}

export function permissionLabel(permission: Permission): string {
  return PERMISSIONS.find((item) => item.key === permission)?.label || permission;
}

export interface RoleDef {
  /** 内置的是 viewer / operator / engineer / admin，自建的是随机 id。账号里存的就是这个。 */
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  builtin: boolean;
}

export const ADMIN_ROLE = "admin";

const OPERATOR: Permission[] = ["alerts", "tickets", "parts.status", "power", "console", "media", "refresh", "logs.collect"];
const ENGINEER: Permission[] = [...OPERATOR, "scripts", "inventory", "bmc.settings", "install", "images", "assets.edit", "dc.edit", "parts.edit", "files"];

/** 内置角色的出厂设置。管理员以外的可以改权限点，改过的存在 roles.json 里。 */
export const BUILTIN_ROLES: RoleDef[] = [
  { id: "viewer", name: "只读", description: "看所有页面、导出表格、下载日志，不能改任何东西", permissions: [], builtin: true },
  { id: "operator", name: "值班", description: "处理告警和工单，电源、远程控制台、虚拟介质，收集日志", permissions: OPERATOR, builtin: true },
  { id: "engineer", name: "工程师", description: "再加跑脚本、装机、采集硬件、BMC 设置，录入和编辑资产、机房、备件、镜像", permissions: ENGINEER, builtin: true },
  { id: ADMIN_ROLE, name: "管理员", description: "全部权限", permissions: ALL_PERMISSIONS, builtin: true },
];

/** 旧数据里的 user 就是工程师。 */
export function normalizeRoleId(value: unknown): string {
  if (value === "user") return "engineer";
  return typeof value === "string" && value ? value : "viewer";
}

export function permissionDenied(permission: Permission): string {
  return `需要「${permissionLabel(permission)}」权限`;
}

const DELETE_ENTITIES = /^\/api\/(assets|customers|datacenters|sites|racks|parts|images|profiles|projects|files)\/[^/]+$/;

/** 写请求（POST/PATCH/PUT/DELETE）要什么权限点，按顺序对第一条。null 是登录了就行（路由里自己再查）。 */
const WRITES: [RegExp, Permission | null][] = [
  // 登录、退出在中间件里就放行了，这里写上免得以为漏了。
  [/^\/api\/auth\//, null],
  // 自己的账号谁都能改，路由里再查是不是本人或有「用户」权限。
  [/^\/api\/users\/[^/]+(\/.*)?$/, null],
  [/^\/api\/users$/, "users"],
  [/^\/api\/roles(\/.*)?$/, "users"],
  [/^\/api\/alerts\/[^/]+\/(ack|resolve|ticket)$/, "alerts"],
  [/^\/api\/tickets(\/.*)?$/, "tickets"],
  [/^\/api\/parts\/[^/]+\/status$/, "parts.status"],
  [/^\/api\/parts(\/[^/]+)?$/, "parts.edit"],
  [/^\/api\/(part-groups|catalog)(\/.*)?$/, "catalog"],
  [/^\/api\/assets\/[^/]+\/control$/, "power"],
  [/^\/api\/assets\/[^/]+\/(sensors|monitor|optics|network)$/, "refresh"],
  [/^\/api\/assets\/[^/]+\/network\/baseline$/, "assets.edit"],
  [/^\/api\/assets\/[^/]+\/redfish\/media$/, "media"],
  [/^\/api\/assets\/[^/]+\/redfish\/bios$/, "bios"],
  [/^\/api\/assets\/[^/]+\/redfish\/firmware$/, "firmware"],
  [/^\/api\/assets\/[^/]+\/redfish\/logs$/, "logs.clear"],
  [/^\/api\/assets\/[^/]+\/redfish$/, "bmc.settings"],
  [/^\/api\/assets\/[^/]+\/bmc-users$/, "bmc.users"],
  [/^\/api\/assets\/[^/]+\/bmc-cert$/, "bmc.settings"],
  [/^\/api\/(assets|assets\/import|assets\/[^/]+|import-jobs(\/.*)?)$/, "assets.edit"],
  [/^\/api\/(customers|datacenters|sites|racks)(\/.*)?$/, "dc.edit"],
  [/^\/api\/(images|profiles)(\/.*)?$/, "images"],
  [/^\/api\/firmware-lib(\/.*)?$/, "firmware"],
  // 任务按类型再细分，见 taskPermission。
  [/^\/api\/(tasks|projects\/[^/]+\/tasks)$/, null],
  [/^\/api\/projects(\/.*)?$/, "install"],
  [/^\/api\/files(\/.*)?$/, "files"],
  [/^\/api\/(settings|snmp-profiles)(\/.*)?$/, "settings"],
];

/**
 * 一个 API 写请求要什么权限点。读（GET）不要，个别只给有权限的人看的由路由自己再查。
 * 删除实体统一要「删除」。对不上的写请求要「用户、角色和审计」（默认只有管理员有），新加接口时记得来这里加一行。
 */
export function requiredPermission(method: string, pathname: string): Permission | null {
  const upper = method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(upper)) return null;
  if (upper === "DELETE" && DELETE_ENTITIES.test(pathname)) return "delete";
  for (const [re, permission] of WRITES) if (re.test(pathname)) return permission;
  return "users";
}

/** 各类批量任务要什么权限点。 */
export function taskPermission(kind: string | undefined): Permission {
  if (kind === "bmc-logs") return "logs.collect";
  if (kind === "bmc-user") return "bmc.users";
  if (kind === "inventory") return "inventory";
  if (kind === "bmc-reset" || kind === "bmc-clock") return "bmc.settings";
  return "scripts";
}
