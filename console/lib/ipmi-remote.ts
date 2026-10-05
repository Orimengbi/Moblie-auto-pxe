import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface IpmiExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type IpmiExec = (host: string, username: string, password: string, args: string[]) => Promise<IpmiExecResult>;

export function parseLanPrint(text: string): { ip?: string; source?: "dhcp" | "static" } {
  let ip: string | undefined;
  let source: "dhcp" | "static" | undefined;
  for (const line of text.split("\n")) {
    const splitAt = line.indexOf(":");
    if (splitAt < 0) continue;
    const key = line.slice(0, splitAt).trim().toLowerCase();
    const value = line.slice(splitAt + 1).trim();
    if (key === "ip address source") {
      if (/dhcp/i.test(value)) source = "dhcp";
      else if (/static/i.test(value)) source = "static";
    }
    if (key === "ip address" && /^\d+\.\d+\.\d+\.\d+$/.test(value) && value !== "0.0.0.0") ip = value;
  }
  return { ip, source };
}

export function parsePowerStatus(text: string): "on" | "off" | "unknown" {
  if (/power is on/i.test(text)) return "on";
  if (/power is off/i.test(text)) return "off";
  return "unknown";
}

/**
 * 认出登录失败的原因。ipmitool 带 -v 时，密码错是 RAKP 2 HMAC is invalid，
 * 用户名错是 unauthorized name；BMC 没有回应是 Get Auth Capabilities error。
 */
export function ipmiFailure(text: string): "denied" | "down" {
  if (/RAKP 2 HMAC is invalid|unauthorized name|invalid (user ?name|password)|insufficient privilege|privilege level not available/i.test(text)) return "denied";
  return "down";
}

export async function probeIpmi(
  host: string,
  username: string,
  password: string,
  exec: IpmiExec,
): Promise<{ link: "up" | "down" | "denied"; ip: string; source: "unknown" | "dhcp" | "static"; power: "on" | "off" | "unknown" }> {
  const lan = await exec(host, username, password, ["lan", "print", "1"]);
  if (lan.code !== 0 && !lan.stdout.trim()) {
    return { link: ipmiFailure(lan.stderr), ip: "", source: "unknown", power: "unknown" };
  }
  const parsed = parseLanPrint(lan.stdout);
  const power = await exec(host, username, password, ["chassis", "power", "status"]);
  return {
    link: "up",
    ip: parsed.ip || "",
    source: parsed.source || "unknown",
    power: parsePowerStatus(power.stdout),
  };
}

export function parseIpmiUserList(text: string): { id: number; name: string }[] {
  const users: { id: number; name: string }[] = [];
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\S+)/);
    if (!match) continue;
    const name = match[2];
    if (name === "true" || name === "false") continue;
    users.push({ id: Number(match[1]), name });
  }
  return users;
}

function fail(result: IpmiExecResult, label: string): never {
  const message = (result.stderr || result.stdout).trim().slice(0, 180);
  throw new Error(message ? `${label}：${message}` : label);
}

export async function changeIpmiAccount(
  input: { host: string; originalUser: string; originalPassword: string; targetUser: string; targetPassword: string },
  exec: IpmiExec,
): Promise<void> {
  const listed = await exec(input.host, input.originalUser, input.originalPassword, ["user", "list", "1"]);
  if (listed.code !== 0) fail(listed, "读不到 BMC 用户列表");
  const user = parseIpmiUserList(listed.stdout).find((item) => item.name.toLowerCase() === input.originalUser.toLowerCase());
  if (!user) throw new Error(`BMC 上没有用户 ${input.originalUser}`);
  const id = String(user.id);
  if (input.targetUser !== input.originalUser) {
    const renamed = await exec(input.host, input.originalUser, input.originalPassword, ["user", "set", "name", id, input.targetUser]);
    if (renamed.code !== 0) fail(renamed, "修改 IPMI 用户名失败");
  }
  const loginUser = input.targetUser;
  const password = await exec(input.host, loginUser, input.originalPassword, ["user", "set", "password", id, input.targetPassword]);
  if (password.code !== 0) fail(password, "修改 IPMI 密码失败");
  const access = await exec(input.host, input.targetUser, input.targetPassword, [
    "channel",
    "setaccess",
    "1",
    id,
    "link=on",
    "ipmi=on",
    "callin=on",
    "privilege=4",
  ]);
  if (access.code !== 0) fail(access, "打开 IPMI 用户权限失败");
  const enabled = await exec(input.host, input.targetUser, input.targetPassword, ["user", "enable", id]);
  if (enabled.code !== 0) fail(enabled, "启用 IPMI 用户失败");
}

export async function setIpmiLan(
  input: { host: string; username: string; password: string; address: string; netmask: string; gateway: string; vlan?: number },
  exec: IpmiExec,
): Promise<void> {
  const run = async (args: string[], label: string) => {
    const result = await exec(input.host, input.username, input.password, args);
    if (result.code !== 0) fail(result, label);
  };
  await run(["lan", "set", "1", "ipsrc", "static"], "设置 IPMI 为静态地址失败");
  await run(["lan", "set", "1", "ipaddr", input.address], "设置 IPMI 地址失败");
  await run(["lan", "set", "1", "netmask", input.netmask], "设置 IPMI 掩码失败");
  await run(["lan", "set", "1", "defgw", "ipaddr", input.gateway], "设置 IPMI 路由失败");
  if (input.vlan) await run(["lan", "set", "1", "vlan", "id", String(input.vlan)], "设置 IPMI VLAN 失败");
}

export async function bootFromPxe(host: string, username: string, password: string, exec: IpmiExec): Promise<void> {
  const boot = await exec(host, username, password, ["chassis", "bootdev", "pxe", "options=efiboot"]);
  if (boot.code !== 0) fail(boot, "设置从网卡启动失败");
  const cycle = await exec(host, username, password, ["chassis", "power", "cycle"]);
  if (cycle.code === 0) return;
  const on = await exec(host, username, password, ["chassis", "power", "on"]);
  if (on.code !== 0) fail(on, "无法开机");
}

export async function defaultIpmiExec(host: string, username: string, password: string, args: string[]): Promise<IpmiExecResult> {
  const file = path.join(os.tmpdir(), `pxe-ipmi-${process.pid}-${Date.now()}.pw`);
  fs.writeFileSync(file, password, { mode: 0o600 });
  try {
    // -v 让 ipmitool 说出登录失败的原因，见 ipmiFailure。
    return await runIpmitool(["-v", "-I", "lanplus", "-H", host, "-U", username, "-f", file, ...args]);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function runIpmitool(args: string[]): Promise<IpmiExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ipmitool", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 20000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(new Error("小主机没有 ipmitool，无法修改 BMC 账号"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const noise = /^(Loading IANA PEN Registry\.\.\.|Using best available cipher suite \d+)$/;
      resolve({ code: code ?? 1, stdout, stderr: stderr.split("\n").filter((line) => line.trim() && !noise.test(line.trim())).join("\n") });
    });
  });
}
