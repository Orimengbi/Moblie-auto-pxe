import crypto from "node:crypto";
import { getSetting, putSetting } from "./db.ts";
import { assertIpv4, ipv4ToInt } from "./net.ts";

/**
 * SSH 跳板机：目标在这几个网段的机器，控制台先用自己的密钥登跳板机，再在跳板机上用跳板机自己的密钥登目标。
 * 目标机上不用放控制台公钥。
 */
export interface JumpHost {
  id: string;
  name: string;
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  /** 走这台跳板机的目标网段，CIDR，如 22.142.0.0/16；单个地址也行。 */
  networks: string[];
  /** 从跳板机登目标用的端口、用户。 */
  targetPort: number;
  targetUser: string;
  /** 跳板机上登目标用的私钥路径，如 ~/.ssh/manage250；空的话用跳板机默认的密钥。 */
  targetKey: string;
}

const KEY = "ssh.jumps";

export function listJumpHosts(): JumpHost[] {
  return getSetting<JumpHost[]>(KEY) || [];
}

function parseNetwork(value: string, label: string): { base: number; mask: number } {
  const [address, prefixText = "32"] = value.trim().split("/");
  const prefix = Number(prefixText);
  if (!/^\d{1,2}$/.test(prefixText) || prefix > 32) throw new Error(`${label}的网段 ${value} 前缀长度要在 0 到 32 之间`);
  assertIpv4(address, `${label}的网段 ${value}`);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (ipv4ToInt(address) & mask) >>> 0, mask };
}

function inNetwork(host: string, network: string): boolean {
  try {
    const { base, mask } = parseNetwork(network, "");
    return ((ipv4ToInt(host) & mask) >>> 0) === base;
  } catch {
    return false;
  }
}

/** 这个地址该走哪台跳板机：按列表顺序第一台启用了、网段包含它的；没有就直连。 */
export function jumpFor(host: string, jumps: JumpHost[] = listJumpHosts()): JumpHost | null {
  return jumps.find((jump) => jump.enabled && jump.networks.some((network) => inNetwork(host, network))) || null;
}

function port(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${label}要是 1 到 65535 的整数`);
  return n;
}

function text(value: unknown, label: string, required = false): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (required && !v) throw new Error(`${label}不能空`);
  if (/[\s'"`$\\;|&<>]/.test(v)) throw new Error(`${label}里不能有空格、引号和 shell 特殊字符`);
  return v;
}

export function normalizeJumpHost(input: Partial<JumpHost>, index = 0): JumpHost {
  const label = `第 ${index + 1} 台跳板机`;
  const networks = (Array.isArray(input.networks) ? input.networks : String(input.networks || "").split(/[\s,，;；]+/)).map((item) => String(item).trim()).filter(Boolean);
  if (!networks.length) throw new Error(`${label}要填至少一个目标网段`);
  for (const network of networks) parseNetwork(network, label);
  return {
    id: typeof input.id === "string" && /^[0-9a-f-]{36}$/.test(input.id) ? input.id : crypto.randomUUID(),
    name: (typeof input.name === "string" ? input.name.trim() : "").slice(0, 60),
    enabled: input.enabled !== false,
    host: text(input.host, `${label}的地址`, true),
    port: port(input.port, 22, `${label}的端口`),
    user: text(input.user, `${label}的用户`) || "root",
    networks,
    targetPort: port(input.targetPort, 22, `${label}的目标 SSH 端口`),
    targetUser: text(input.targetUser, `${label}的目标用户`) || "root",
    targetKey: text(input.targetKey, `${label}的目标私钥路径`),
  };
}

export function saveJumpHosts(input: unknown): JumpHost[] {
  if (!Array.isArray(input)) throw new Error("跳板机列表格式不对");
  const jumps = input.map((item, index) => normalizeJumpHost((item || {}) as Partial<JumpHost>, index));
  putSetting(KEY, jumps);
  return jumps;
}

export function jumpLabel(jump: JumpHost): string {
  return `${jump.name ? `${jump.name} ` : ""}${jump.user}@${jump.host}:${jump.port}`;
}
