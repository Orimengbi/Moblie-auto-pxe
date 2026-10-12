/** BMC IPMI 用户的类型和标签。页面也要用，这里不能引 Node 模块。 */

export type IpmiPrivilege = "USER" | "OPERATOR" | "ADMINISTRATOR";

export interface IpmiUser {
  id: number;
  name: string;
  /** 名字是 BMC 固定的（AMI 的 1 号匿名用户），改不了。 */
  fixed: boolean;
  enabled: boolean;
  privilege: IpmiPrivilege | "CALLBACK" | "OEM" | "NO ACCESS";
  /** LAN 通道上能不能用 IPMI。 */
  ipmi: boolean;
  link: boolean;
}

export type BmcUserAction = "ensure" | "password" | "privilege" | "enable" | "disable" | "delete";

export interface BmcUserChange {
  action: BmcUserAction;
  name: string;
  password?: string;
  privilege?: IpmiPrivilege;
}

export const IPMI_PRIVILEGE_LABEL: Record<IpmiUser["privilege"], string> = {
  ADMINISTRATOR: "管理员",
  OPERATOR: "操作员",
  USER: "普通用户",
  CALLBACK: "回调",
  OEM: "OEM",
  "NO ACCESS": "无权限",
};

export const BMC_USER_ACTION_LABEL: Record<BmcUserAction, string> = {
  ensure: "新建或更新",
  password: "改密码",
  privilege: "改权限",
  enable: "启用",
  disable: "停用",
  delete: "删除",
};

/** 任务名、审计里用的一句话，不带密码。 */
export function describeUserChange(change: BmcUserChange): string {
  if (change.action === "ensure") return `BMC 用户 ${change.name}：新建或更新（${change.privilege ? IPMI_PRIVILEGE_LABEL[change.privilege] : ""}）`;
  if (change.action === "privilege") return `BMC 用户 ${change.name}：权限改成${change.privilege ? IPMI_PRIVILEGE_LABEL[change.privilege] : ""}`;
  return `BMC 用户 ${change.name}：${BMC_USER_ACTION_LABEL[change.action]}`;
}
