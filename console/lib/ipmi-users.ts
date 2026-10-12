import { assetBmcAccounts, updateAsset } from "./assets.ts";
import { deleteAccount, openSession } from "./bmc-redfish.ts";
import { defaultIpmiExec, firstWorkingAccount, ipmiFailure, type IpmiExec, type IpmiExecResult } from "./ipmi-remote.ts";
import type { BmcUserChange, IpmiPrivilege, IpmiUser } from "./ipmi-user-types.ts";
import type { Asset } from "./types.ts";

/**
 * BMC 的 IPMI 用户（LAN 通道 1，16 个槽位）：列出、新建、改密码、改权限、启用停用、删除。
 * 用资产上能登录的那个账号去改。改了控制台自己登录用的那个账号的密码时，顺手把资产里存的密码也改掉。
 */

const CHANNEL = "1";
const PRIVILEGE_CODE: Record<IpmiPrivilege, string> = { USER: "2", OPERATOR: "3", ADMINISTRATOR: "4" };
const PRIVILEGE_FROM_TEXT: Record<string, IpmiUser["privilege"]> = {
  CALLBACK: "CALLBACK",
  USER: "USER",
  OPERATOR: "OPERATOR",
  ADMINISTRATOR: "ADMINISTRATOR",
  OEM: "OEM",
  "NO ACCESS": "NO ACCESS",
};

const userExec: IpmiExec = (host, user, password, args) => defaultIpmiExec(host, user, password, args, 30_000, false);

/** `ipmitool channel getaccess 1` 不带用户号时列出全部槽位。纯函数。 */
export function parseChannelAccess(text: string): IpmiUser[] {
  const users: IpmiUser[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const field = (name: string) => block.match(new RegExp(`^${name}\\s*:[ \\t]*(.*)$`, "m"))?.[1]?.trim() ?? null;
    const id = Number(field("User ID"));
    if (!Number.isInteger(id) || id < 1) continue;
    const privilege = (field("Privilege Level") || "").toUpperCase();
    users.push({
      id,
      name: field("User Name") || "",
      fixed: /^yes$/i.test(field("Fixed Name") || ""),
      enabled: /^enabled$/i.test(field("Enable Status") || ""),
      privilege: PRIVILEGE_FROM_TEXT[privilege] || "NO ACCESS",
      ipmi: /^enabled$/i.test(field("IPMI Messaging") || ""),
      link: /^enabled$/i.test(field("Link Authentication") || ""),
    });
  }
  return users.sort((a, b) => a.id - b.id);
}

export function validUserName(name: string): string {
  const value = name.trim();
  if (!/^[A-Za-z0-9_.@-]{1,16}$/.test(value)) throw new Error("用户名 1 到 16 个字符，只能有字母、数字和 _ . @ -");
  return value;
}

export function validPassword(password: string): string {
  if (password.length < 8 || password.length > 20) throw new Error("密码 8 到 20 个字符");
  if (/[\s'"`\\]/.test(password) || /[^\x21-\x7e]/.test(password)) throw new Error("密码里不能有空格、引号、反斜杠和中文");
  return password;
}

function validPrivilege(value: unknown): IpmiPrivilege {
  if (value === "USER" || value === "OPERATOR" || value === "ADMINISTRATOR") return value;
  throw new Error("权限只能是 USER、OPERATOR 或 ADMINISTRATOR");
}

/** 页面和批量任务传进来的改动，检查一遍。 */
export function cleanUserChange(input: Partial<BmcUserChange> | undefined): BmcUserChange {
  const action = input?.action;
  if (action !== "ensure" && action !== "password" && action !== "privilege" && action !== "enable" && action !== "disable" && action !== "delete") throw new Error("不认识的操作");
  const name = validUserName(String(input?.name || ""));
  const change: BmcUserChange = { action, name };
  if (action === "ensure" || action === "password") change.password = validPassword(String(input?.password || ""));
  if (action === "ensure" || action === "privilege") change.privilege = validPrivilege(input?.privilege);
  return change;
}

function failure(result: IpmiExecResult, label: string): Error {
  const said = (result.stderr || result.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 180);
  return new Error(said ? `${label}：${said}` : label);
}

interface Login {
  host: string;
  user: string;
  password: string;
}

async function login(asset: Asset, exec: IpmiExec): Promise<Login> {
  if (!asset.bmcIp) throw new Error(`${asset.sn} 还没有 BMC 地址`);
  const accounts = assetBmcAccounts(asset);
  if (!accounts.length) throw new Error(`${asset.sn} 没有 BMC 账号密码`);
  const { account, result } = await firstWorkingAccount(asset.bmcIp, accounts, exec);
  if (!account) throw new Error(ipmiFailure(result.stderr) === "denied" ? `BMC ${asset.bmcIp} 不接受资产里的账号密码` : `BMC ${asset.bmcIp} 的 IPMI 没有回应`);
  return { host: asset.bmcIp, user: account.user, password: account.password };
}

async function run(session: Login, exec: IpmiExec, args: string[], label: string): Promise<IpmiExecResult> {
  const result = await exec(session.host, session.user, session.password, args);
  if (result.code !== 0) throw failure(result, label);
  return result;
}

async function readUsers(session: Login, exec: IpmiExec): Promise<IpmiUser[]> {
  return parseChannelAccess((await run(session, exec, ["channel", "getaccess", CHANNEL], "读不到 BMC 用户列表")).stdout);
}

export async function listIpmiUsers(asset: Asset, exec: IpmiExec = userExec): Promise<{ users: IpmiUser[]; loginUser: string }> {
  const session = await login(asset, exec);
  return { users: await readUsers(session, exec), loginUser: session.user };
}

function isLogin(session: Login, user: IpmiUser): boolean {
  return user.name.toLowerCase() === session.user.toLowerCase();
}

/** 改了资产里存的账号的密码，资产记录跟着改，以后控制台还能登。 */
function syncAssetPassword(asset: Asset, name: string, password: string, actor: string): boolean {
  const lower = name.toLowerCase();
  if (asset.bmcUser && asset.bmcUser.toLowerCase() === lower) {
    updateAsset(asset.id, { bmcPassword: password }, actor);
    return true;
  }
  if (asset.bmcFallbackUser && asset.bmcFallbackUser.toLowerCase() === lower) {
    updateAsset(asset.id, { bmcFallbackPassword: password }, actor);
    return true;
  }
  return false;
}

async function setPassword(session: Login, exec: IpmiExec, id: number, password: string): Promise<void> {
  // 超过 16 位要用 IPMI 2.0 的 20 字节密码。
  await run(session, exec, ["user", "set", "password", String(id), password, ...(password.length > 16 ? ["20"] : [])], "改密码失败");
}

async function setAccess(session: Login, exec: IpmiExec, id: number, privilege: IpmiPrivilege): Promise<void> {
  await run(session, exec, ["channel", "setaccess", CHANNEL, String(id), "link=on", "ipmi=on", "callin=on", `privilege=${PRIVILEGE_CODE[privilege]}`], "设置权限失败");
}

/** 用新账号按它的权限登一次（ipmitool 默认按管理员建会话，普通用户会被拒），确认改的密码真的生效了。 */
async function verifyLogin(host: string, user: string, password: string, privilege: IpmiPrivilege, exec: IpmiExec): Promise<void> {
  const result = await exec(host, user, password, ["-L", privilege, "mc", "info"]);
  if (result.code !== 0) throw failure(result, `改完后用 ${user} 登不上`);
}

function loginPrivilege(user: IpmiUser): IpmiPrivilege | null {
  return user.enabled && (user.privilege === "USER" || user.privilege === "OPERATOR" || user.privilege === "ADMINISTRATOR") ? user.privilege : null;
}

/** 测试换掉 Redfish 删账号这一步。 */
export interface UserDeps {
  deleteRedfishAccount?: (asset: Asset, name: string) => Promise<boolean>;
}

async function redfishDelete(asset: Asset, name: string): Promise<boolean> {
  return deleteAccount(await openSession(asset), name);
}

/**
 * 在一台 BMC 上做一次用户改动，返回做了什么（一行一件事）。
 * ensure：没有就新建，有了就改成给的密码和权限并启用。按用户名找，各台槽位号不一样也没关系。
 */
export async function applyUserChange(asset: Asset, input: BmcUserChange, actor: string, exec: IpmiExec = userExec, deps: UserDeps = {}): Promise<string[]> {
  const change = cleanUserChange(input);
  let session = await login(asset, exec);
  const users = await readUsers(session, exec);
  const existing = users.find((user) => user.name.toLowerCase() === change.name.toLowerCase());
  const done: string[] = [];

  if (change.action === "ensure") {
    let target = existing;
    if (!target) {
      // 1 号是匿名用户（AMI 固定名字），从 2 号往后找空槽。
      target = users.find((user) => user.id >= 2 && !user.name && !user.fixed);
      if (!target) throw new Error("BMC 上 16 个用户槽都占满了");
      await run(session, exec, ["user", "set", "name", String(target.id), change.name], "设置用户名失败");
      done.push(`新建用户 ${change.name}（${target.id} 号槽）`);
    } else if (isLogin(session, existing!) && change.privilege !== "ADMINISTRATOR") {
      throw new Error(`${change.name} 是控制台登这台 BMC 用的账号，不能降成 ${change.privilege}`);
    }
    await setPassword(session, exec, target.id, change.password!);
    // 改的是自己登录用的账号，后面几步要用新密码登。
    if (existing && isLogin(session, existing)) session = { ...session, password: change.password! };
    await setAccess(session, exec, target.id, change.privilege!);
    await run(session, exec, ["user", "enable", String(target.id)], "启用用户失败");
    if (existing) done.push(`${existing.name}：改了密码，权限 ${change.privilege}，已启用`);
    else done.push(`权限 ${change.privilege}，已启用`);
    // IPMI 用户名区分大小写，已有的按 BMC 上的写法登。
    const actual = existing?.name || change.name;
    await verifyLogin(session.host, actual, change.password!, change.privilege!, exec);
    done.push(`已用 ${actual} 登录验证`);
    if (syncAssetPassword(asset, actual, change.password!, actor)) done.push("资产里存的 BMC 密码已同步");
    return done;
  }

  if (!existing) {
    if (change.action === "delete" || change.action === "disable") return [`BMC 上没有用户 ${change.name}，不用改`];
    throw new Error(`BMC 上没有用户 ${change.name}`);
  }
  const id = String(existing.id);
  const self = isLogin(session, existing);

  if (change.action === "password") {
    await setPassword(session, exec, existing.id, change.password!);
    const privilege = loginPrivilege(existing);
    if (privilege) {
      await verifyLogin(session.host, existing.name, change.password!, privilege, exec);
      done.push(`${existing.name}：改了密码，已用新密码登录验证`);
    } else {
      done.push(`${existing.name}：改了密码（这个用户${existing.enabled ? "没有登录权限" : "停用着"}，没法登录验证）`);
    }
    if (syncAssetPassword(asset, existing.name, change.password!, actor)) done.push("资产里存的 BMC 密码已同步");
    return done;
  }
  if (change.action === "privilege") {
    if (self && change.privilege !== "ADMINISTRATOR") throw new Error(`${existing.name} 是控制台登这台 BMC 用的账号，不能降成 ${change.privilege}`);
    await setAccess(session, exec, existing.id, change.privilege!);
    return [`${existing.name}：权限改成 ${change.privilege}`];
  }
  if (self) throw new Error(`${existing.name} 是控制台登这台 BMC 用的账号，不能${change.action === "delete" ? "删" : "停用"}`);
  const otherAdmins = users.filter((user) => user.id !== existing.id && user.enabled && user.privilege === "ADMINISTRATOR" && user.name);
  if (existing.enabled && existing.privilege === "ADMINISTRATOR" && !otherAdmins.length) throw new Error(`${existing.name} 是最后一个能用的管理员，不能${change.action === "delete" ? "删" : "停用"}`);
  if (change.action === "enable") {
    await run(session, exec, ["user", "enable", id], "启用用户失败");
    return [`${existing.name}：已启用`];
  }
  await run(session, exec, ["user", "disable", id], "停用用户失败");
  if (change.action === "disable") return [`${existing.name}：已停用`];
  await run(session, exec, ["channel", "setaccess", CHANNEL, id, "link=off", "ipmi=off", "callin=off", "privilege=15"], "收回权限失败");
  // 用户名清空（Set User Name 给 16 个 0），这个槽就空出来了。AMI 不让清，改用 Redfish 删账号。
  const cleared = await exec(session.host, session.user, session.password, ["raw", "0x06", "0x45", `0x${existing.id.toString(16).padStart(2, "0")}`, ...Array(16).fill("0x00")]);
  if (cleared.code === 0) return [`${existing.name}：已删除（${existing.id} 号槽空出来了）`];
  try {
    if (await (deps.deleteRedfishAccount || redfishDelete)(asset, existing.name)) return [`${existing.name}：已删除（经 Redfish，${existing.id} 号槽空出来了）`];
    return [`${existing.name}：已停用并收回权限（IPMI 清不掉用户名，Redfish 里也找不到这个账号，槽位还占着）`];
  } catch (error) {
    return [`${existing.name}：已停用并收回权限（清用户名失败：${error instanceof Error ? error.message.slice(0, 120) : "Redfish 连不上"}，槽位还占着）`];
  }
}
