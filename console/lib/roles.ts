/**
 * 用户分级：只读 < 值班 < 工程师 < 管理员，高一级包含低一级能做的事。
 * 页面和中间件都用这个文件（不依赖 Node 模块）。
 *
 * - 只读：看所有页面、导出表格、下载日志。
 * - 值班：再加告警确认、工单、备件状态、电源和引导、远程控制台、虚拟介质、立即刷新传感器/监控/SNMP/收发光、批量收集日志。
 * - 工程师：再加跑脚本、PXE 装机、采集硬件、交付清理、重启 BMC、BMC 设置，录入和编辑资产、机房、客户、备件、镜像、配置模板。
 * - 管理员：再加 BIOS、固件、BMC 用户、清日志、删除、系统设置、用户和审计。
 */

export type Role = "viewer" | "operator" | "engineer" | "admin";

export const ROLES: Role[] = ["viewer", "operator", "engineer", "admin"];

const RANK: Record<Role, number> = { viewer: 0, operator: 1, engineer: 2, admin: 3 };

export const ROLE_LABEL: Record<Role, string> = { viewer: "只读", operator: "值班", engineer: "工程师", admin: "管理员" };

export const ROLE_HINT: Record<Role, string> = {
  viewer: "看所有页面、导出表格、下载日志，不能改任何东西",
  operator: "再加告警确认、工单、备件状态、电源和引导、远程控制台、虚拟介质、批量收集日志",
  engineer: "再加跑脚本、PXE 装机、采集硬件、重启 BMC，录入和编辑资产、机房、客户、备件、镜像",
  admin: "再加 BIOS、固件、BMC 用户、删除、系统设置、用户和审计",
};

/** 旧数据里的 user 就是现在的工程师（原来普通用户除了管理员专属的都能做）。 */
export function normalizeRole(value: unknown): Role {
  if (value === "user") return "engineer";
  return ROLES.includes(value as Role) ? (value as Role) : "viewer";
}

export function atLeast(role: Role | string | undefined, min: Role): boolean {
  return RANK[normalizeRole(role)] >= RANK[min];
}

/** 两个里低的那个，访问密钥限权用。 */
export function lowerRole(a: Role, b: Role): Role {
  return RANK[a] <= RANK[b] ? a : b;
}

export function roleDenied(min: Role): string {
  return min === "admin" ? "需要管理员权限" : `需要「${ROLE_LABEL[min]}」及以上权限`;
}

/** 值班就能做的写操作（POST/PATCH/PUT/DELETE）。 */
const OPERATOR_WRITES: RegExp[] = [
  /^\/api\/alerts\/[^/]+\/(ack|resolve|ticket)$/,
  /^\/api\/tickets(\/.*)?$/,
  /^\/api\/parts\/[^/]+\/status$/,
  /^\/api\/assets\/[^/]+\/(control|sensors|monitor|optics|network)$/,
  /^\/api\/assets\/[^/]+\/redfish\/media$/,
  // 任务按类型再细分，见 taskRole。
  /^\/api\/tasks$/,
  /^\/api\/projects\/[^/]+\/tasks$/,
];

/** 自己的账号（改密码、加删密钥）谁都能改，路由里再查是不是本人或管理员。 */
const SELF_WRITES: RegExp[] = [/^\/api\/users\/[^/]+(\/.*)?$/];

/**
 * 一个 API 请求至少要什么角色。读（GET）只读就行，个别只给管理员看的由路由自己再查；
 * 写默认要工程师，值班能做的在上面列出来；管理员专属的写操作路由里用 requireAdmin 再查。
 */
export function requiredRole(method: string, pathname: string): Role {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return "viewer";
  if (SELF_WRITES.some((re) => re.test(pathname))) return "viewer";
  if (OPERATOR_WRITES.some((re) => re.test(pathname))) return "operator";
  return "engineer";
}

/** 各类批量任务要什么角色。 */
export function taskRole(kind: string | undefined): Role {
  if (kind === "bmc-logs") return "operator";
  if (kind === "bmc-user") return "admin";
  return "engineer";
}
