import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./paths.ts";

/**
 * 控制台登录。账号存在 data/auth/users.json，三种登录方式：
 * 密码、访问密钥（pxe_ 开头，也能当 Bearer 调 API）、SSH 公钥签名（ssh-keygen -Y sign）。
 * 会话放在签名 cookie 里；改密码、停用、改角色或删掉登录所用的密钥后，旧会话立即失效。
 */

export type Role = "admin" | "user";

export interface SshKey {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

export interface AccessKey {
  id: string;
  name: string;
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface User {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  disabled: boolean;
  version: number;
  sshKeys: SshKey[];
  accessKeys: AccessKey[];
  createdAt: string;
  updatedAt: string;
}

/** 给页面和 API 的用户信息，不含任何哈希。 */
export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
  sshKeys: SshKey[];
  accessKeys: Omit<AccessKey, "hash">[];
  createdAt: string;
}

export type LoginMethod = "password" | "key" | "ssh";

export interface Identity {
  user: User;
  method: LoginMethod;
  /** 用访问密钥或 SSH 公钥登录时是那把钥匙的 id，删掉钥匙会话就失效。 */
  credentialId: string;
}

export const SESSION_COOKIE = "pxe_session";
export const SESSION_SECONDS = 7 * 24 * 3600;
export const SSH_NAMESPACE = "pxe-console";
const CHALLENGE_SECONDS = 5 * 60;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

function authDir(): string {
  return path.join(dataDir(), "auth");
}

function usersPath(): string {
  return path.join(authDir(), "users.json");
}

export function initialPasswordPath(): string {
  return path.join(authDir(), "initial-admin-password");
}

function now(): string {
  return new Date().toISOString();
}

function writePrivate(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

let cache: { mtimeMs: number; users: User[] } | null = null;

function writeUsers(users: User[]): void {
  writePrivate(usersPath(), `${JSON.stringify(users, null, 2)}\n`);
  cache = null;
}

/** 第一次启动时生成 admin 和随机密码，密码写到 data/auth/initial-admin-password。 */
function bootstrap(): void {
  if (fs.existsSync(usersPath())) return;
  const password = crypto.randomBytes(12).toString("base64url");
  const admin = newUser("admin", "admin");
  admin.passwordHash = hashLoginPassword(password);
  writePrivate(initialPasswordPath(), `${password}\n`);
  writeUsers([admin]);
  console.log(`[auth] 已创建管理员 admin，初始密码在 ${initialPasswordPath()}`);
}

export function listUsers(): User[] {
  bootstrap();
  const mtimeMs = fs.statSync(usersPath()).mtimeMs;
  if (cache?.mtimeMs !== mtimeMs) {
    cache = { mtimeMs, users: JSON.parse(fs.readFileSync(usersPath(), "utf8")) as User[] };
  }
  return cache.users;
}

function mutate<T>(fn: (users: User[]) => T): T {
  const users = structuredClone(listUsers());
  const result = fn(users);
  writeUsers(users);
  return result;
}

function newUser(username: string, role: Role): User {
  const at = now();
  return {
    id: crypto.randomUUID(),
    username,
    role,
    passwordHash: "",
    disabled: false,
    version: 1,
    sshKeys: [],
    accessKeys: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: user.disabled,
    hasPassword: Boolean(user.passwordHash),
    sshKeys: user.sshKeys,
    accessKeys: user.accessKeys.map(({ hash: _hash, ...rest }) => rest),
    createdAt: user.createdAt,
  };
}

// ---- 密码 ----

export function hashLoginPassword(plain: string): string {
  if (plain.length < 8) throw new Error("密码至少 8 位");
  if (plain.length > 128) throw new Error("密码过长");
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyLoginPassword(plain: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = crypto.scryptSync(plain, Buffer.from(salt, "base64url"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---- 会话和挑战的签名 ----

function secret(): Buffer {
  const file = path.join(authDir(), "secret");
  if (!fs.existsSync(file)) writePrivate(file, crypto.randomBytes(32).toString("base64url"));
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64url");
}

/** 其他模块（远程控制台票据）也用这把密钥签短期令牌。 */
export function signPayload(payload: object): string {
  return sign(payload);
}

export function verifyPayload<T>(token: string): T | null {
  return unsign<T>(token);
}

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unsign<T>(token: string): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

interface SessionPayload {
  u: string;
  v: number;
  m: LoginMethod;
  k: string;
  e: number;
}

export function createSession(identity: Identity): string {
  return sign({
    u: identity.user.id,
    v: identity.user.version,
    m: identity.method,
    k: identity.credentialId,
    e: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  } satisfies SessionPayload);
}

function credentialAlive(user: User, method: LoginMethod, credentialId: string): boolean {
  if (method === "password") return Boolean(user.passwordHash);
  if (method === "key") return user.accessKeys.some((key) => key.id === credentialId);
  return user.sshKeys.some((key) => key.id === credentialId);
}

export function readSession(token: string): Identity | null {
  const payload = unsign<SessionPayload>(token);
  if (!payload || payload.e < Date.now() / 1000) return null;
  const user = listUsers().find((item) => item.id === payload.u);
  if (!user || user.disabled || user.version !== payload.v) return null;
  if (!credentialAlive(user, payload.m, payload.k)) return null;
  return { user, method: payload.m, credentialId: payload.k };
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function cookieValue(header: string | null, name: string): string {
  for (const part of (header || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

// ---- 访问密钥 ----

function hashSecret(secretPart: string): string {
  return crypto.createHash("sha256").update(secretPart).digest("base64url");
}

/** 密钥格式 pxe_<id>_<secret>，库里只存 secret 的 sha256。 */
export function verifyAccessKey(raw: string): Identity | null {
  const match = /^pxe_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/.exec(raw.trim());
  if (!match) return null;
  const [, id, secretPart] = match;
  const hash = Buffer.from(hashSecret(secretPart));
  for (const user of listUsers()) {
    const key = user.accessKeys.find((item) => item.id === id);
    if (!key) continue;
    if (user.disabled || !crypto.timingSafeEqual(hash, Buffer.from(key.hash))) return null;
    touchAccessKey(user.id, id);
    return { user, method: "key", credentialId: id };
  }
  return null;
}

/** 最近使用时间一小时最多写一次，脚本频繁调 API 也不会一直改文件。 */
function touchAccessKey(userId: string, keyId: string): void {
  const user = listUsers().find((item) => item.id === userId);
  const key = user?.accessKeys.find((item) => item.id === keyId);
  if (!key || (key.lastUsedAt && Date.now() - Date.parse(key.lastUsedAt) < 3600_000)) return;
  mutate((users) => {
    const target = users.find((item) => item.id === userId)?.accessKeys.find((item) => item.id === keyId);
    if (target) target.lastUsedAt = now();
  });
}

// ---- 请求鉴权 ----

/** 先看 Authorization: Bearer pxe_...，再看会话 cookie。 */
export function authenticate(headers: Pick<Headers, "get">): Identity | null {
  const authorization = headers.get("authorization") || "";
  if (/^bearer\s+/i.test(authorization)) return verifyAccessKey(authorization.replace(/^bearer\s+/i, ""));
  const token = cookieValue(headers.get("cookie"), SESSION_COOKIE);
  return token ? readSession(token) : null;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function requireUser(request: Request): Identity {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request.headers)) {
    throw new AuthError("跨站请求被拒绝", 403);
  }
  const identity = authenticate(request.headers);
  if (!identity) throw new AuthError("需要登录", 401);
  return identity;
}

export function requireAdmin(request: Request): Identity {
  const identity = requireUser(request);
  if (identity.user.role !== "admin") throw new AuthError("需要管理员权限", 403);
  return identity;
}

/** 管理员可以管所有人，普通用户只能管自己。 */
export function requireSelfOrAdmin(request: Request, userId: string): Identity {
  const identity = requireUser(request);
  if (identity.user.role !== "admin" && identity.user.id !== userId) throw new AuthError("只能修改自己的账号", 403);
  return identity;
}

// ---- 登录 ----

export function loginWithPassword(username: string, password: string): Identity | null {
  const user = listUsers().find((item) => item.username === username.trim().toLowerCase());
  if (!user) {
    // 用户不存在也算一次哈希，响应时间不暴露用户名是否存在。
    crypto.scryptSync(password, "pxe-dummy-salt", 32);
    return null;
  }
  if (user.disabled || !user.passwordHash || !verifyLoginPassword(password, user.passwordHash)) return null;
  return { user, method: "password", credentialId: "" };
}

interface ChallengePayload {
  t: "ssh";
  u: string;
  n: string;
  e: number;
}

/** 挑战码本身是签名过的，不用存；用过的记在内存里防止重放。 */
export function sshChallenge(username: string): string {
  return sign({
    t: "ssh",
    u: username.trim().toLowerCase(),
    n: crypto.randomBytes(16).toString("base64url"),
    e: Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS,
  } satisfies ChallengePayload);
}

const usedChallenges = new Map<string, number>();

export function loginWithSsh(challenge: string, signature: string): Identity | null {
  const payload = unsign<ChallengePayload>(challenge.trim());
  if (!payload || payload.t !== "ssh" || payload.e < Date.now() / 1000) return null;
  for (const [nonce, expires] of usedChallenges) if (expires < Date.now() / 1000) usedChallenges.delete(nonce);
  if (usedChallenges.has(payload.n)) return null;
  const user = listUsers().find((item) => item.username === payload.u);
  if (!user || user.disabled || !user.sshKeys.length) return null;
  const fingerprint = verifySshSignature(user, challenge.trim(), signature);
  const key = user.sshKeys.find((item) => item.fingerprint === fingerprint);
  if (!key) return null;
  usedChallenges.set(payload.n, payload.e);
  return { user, method: "ssh", credentialId: key.id };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pxe-auth-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 用 ssh-keygen -Y verify 校验，返回签名所用公钥的指纹，失败返回空串。 */
function verifySshSignature(user: User, message: string, signature: string): string {
  const armored = signature.trim();
  if (!armored.startsWith("-----BEGIN SSH SIGNATURE-----") || armored.length > 16384) return "";
  return withTempDir((dir) => {
    const signers = user.sshKeys.map((key) => `${user.username} namespaces="${SSH_NAMESPACE}" ${key.publicKey}`).join("\n");
    fs.writeFileSync(path.join(dir, "allowed_signers"), `${signers}\n`);
    fs.writeFileSync(path.join(dir, "message.sig"), `${armored}\n`);
    const result = spawnSync(
      "ssh-keygen",
      ["-Y", "verify", "-f", path.join(dir, "allowed_signers"), "-I", user.username, "-n", SSH_NAMESPACE, "-s", path.join(dir, "message.sig")],
      { input: message, encoding: "utf8", timeout: 10_000 },
    );
    if (result.status !== 0) return "";
    return /(SHA256:[A-Za-z0-9+/]+)/.exec(result.stdout)?.[1] || "";
  });
}

/** 校验一行 OpenSSH 公钥，返回规整后的 "类型 base64" 和指纹。 */
export function parseSshPublicKey(line: string): { publicKey: string; fingerprint: string; comment: string } {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2 || !/^(ssh-|ecdsa-|sk-)[A-Za-z0-9@.-]+$/.test(parts[0]) || !/^[A-Za-z0-9+/=]+$/.test(parts[1])) {
    throw new Error("不是 OpenSSH 公钥，应以 ssh-ed25519、ssh-rsa 或 ecdsa- 开头");
  }
  const publicKey = `${parts[0]} ${parts[1]}`;
  const fingerprint = withTempDir((dir) => {
    const file = path.join(dir, "key.pub");
    fs.writeFileSync(file, `${publicKey}\n`);
    const result = spawnSync("ssh-keygen", ["-l", "-E", "sha256", "-f", file], { encoding: "utf8", timeout: 10_000 });
    return result.status === 0 ? /(SHA256:[A-Za-z0-9+/]+)/.exec(result.stdout)?.[1] || "" : "";
  });
  if (!fingerprint) throw new Error("公钥无法识别");
  return { publicKey, fingerprint, comment: parts.slice(2).join(" ") };
}

// ---- 登录失败限速 ----

const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60_000;

function recent(key: string): number[] {
  const list = (failures.get(key) || []).filter((at) => Date.now() - at < WINDOW_MS);
  failures.set(key, list);
  return list;
}

/** 同一地址 15 分钟内失败 10 次，或同一用户名失败 20 次，就先拒绝。 */
export function loginBlocked(address: string, username: string): boolean {
  return recent(`ip:${address}`).length >= 10 || (Boolean(username) && recent(`user:${username}`).length >= 20);
}

export function recordLoginFailure(address: string, username: string): void {
  recent(`ip:${address}`).push(Date.now());
  if (username) recent(`user:${username}`).push(Date.now());
}

export function clearLoginFailures(address: string): void {
  failures.delete(`ip:${address}`);
}

/** 浏览器发来的写请求必须来自控制台自己的页面；脚本不带 Origin，靠 Bearer 密钥。 */
export function sameOrigin(headers: Pick<Headers, "get">): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === headers.get("host");
  } catch {
    return false;
  }
}

export function clientAddress(headers: Pick<Headers, "get">): string {
  return headers.get("x-real-ip") || headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

// ---- 用户管理 ----

function findUser(users: User[], id: string): User {
  const user = users.find((item) => item.id === id);
  if (!user) throw new Error("用户不存在");
  return user;
}

function assertAdminRemains(users: User[]): void {
  if (!users.some((user) => user.role === "admin" && !user.disabled)) throw new Error("至少要保留一个启用的管理员");
}

export function getUser(id: string): User | null {
  return listUsers().find((user) => user.id === id) || null;
}

export function createUser(input: { username?: string; role?: string; password?: string }): User {
  const username = String(input.username || "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new Error("用户名只能用小写字母、数字、点、下划线和横线，最长 32 位");
  const role: Role = input.role === "admin" ? "admin" : "user";
  const user = newUser(username, role);
  if (input.password) user.passwordHash = hashLoginPassword(String(input.password));
  return mutate((users) => {
    if (users.some((item) => item.username === username)) throw new Error("用户名已存在");
    users.push(user);
    return user;
  });
}

export function updateUser(id: string, input: { role?: string; disabled?: boolean; password?: string | null }): User {
  const passwordHash = typeof input.password === "string" && input.password ? hashLoginPassword(input.password) : null;
  return mutate((users) => {
    const user = findUser(users, id);
    if (input.role !== undefined) {
      if (input.role !== "admin" && input.role !== "user") throw new Error("角色只能是 admin 或 user");
      user.role = input.role;
    }
    if (input.disabled !== undefined) user.disabled = Boolean(input.disabled);
    if (passwordHash) user.passwordHash = passwordHash;
    if (input.password === null) user.passwordHash = "";
    assertAdminRemains(users);
    user.version += 1;
    user.updatedAt = now();
    return user;
  });
}

export function deleteUser(id: string): void {
  mutate((users) => {
    findUser(users, id);
    users.splice(users.findIndex((item) => item.id === id), 1);
    assertAdminRemains(users);
  });
}

export function addSshKey(userId: string, input: { name?: string; publicKey?: string }): SshKey {
  const parsed = parseSshPublicKey(String(input.publicKey || ""));
  return mutate((users) => {
    const user = findUser(users, userId);
    if (user.sshKeys.some((key) => key.fingerprint === parsed.fingerprint)) throw new Error("这把公钥已经添加过");
    const key: SshKey = {
      id: crypto.randomBytes(8).toString("hex"),
      name: String(input.name || "").trim() || parsed.comment || parsed.fingerprint,
      publicKey: parsed.publicKey,
      fingerprint: parsed.fingerprint,
      createdAt: now(),
    };
    user.sshKeys.push(key);
    user.updatedAt = now();
    return key;
  });
}

export function removeSshKey(userId: string, keyId: string): void {
  mutate((users) => {
    const user = findUser(users, userId);
    user.sshKeys = user.sshKeys.filter((key) => key.id !== keyId);
    user.updatedAt = now();
  });
}

/** 返回完整密钥，只有这一次能看到。 */
export function createAccessKey(userId: string, input: { name?: string }): { key: Omit<AccessKey, "hash">; secret: string } {
  const id = crypto.randomBytes(8).toString("hex");
  const secretPart = crypto.randomBytes(32).toString("base64url");
  const record: AccessKey = { id, name: String(input.name || "").trim() || "访问密钥", hash: hashSecret(secretPart), createdAt: now() };
  mutate((users) => {
    const user = findUser(users, userId);
    user.accessKeys.push(record);
    user.updatedAt = now();
  });
  const { hash: _hash, ...key } = record;
  return { key, secret: `pxe_${id}_${secretPart}` };
}

export function removeAccessKey(userId: string, keyId: string): void {
  mutate((users) => {
    const user = findUser(users, userId);
    user.accessKeys = user.accessKeys.filter((key) => key.id !== keyId);
    user.updatedAt = now();
  });
}
