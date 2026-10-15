import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { db, SCHEMA_VERSION } from "./db.ts";
import { dataDir } from "./paths.ts";
import { listAllTasks, listImages } from "./store.ts";

/**
 * 备份、恢复和升级（「系统」页和 pxectl 共用）。
 *
 * 备份是 data/ 的一份 tar.zst：数据库用 VACUUM INTO 拍一份一致的快照，其余文件原样打包。
 * 镜像、固件包这些大目录可选（「完整备份」才带）。备份放在 data/backups/，旁边一个同名 .json 记清单。
 *
 * 恢复分两步：先把备份解到 data/.restore/stage 并写 pending.json，再重启控制台；
 * 下次启动时、任何模块打开数据库之前，applyPendingRestore 把解好的文件换进 data/。
 *
 * 升级由宿主机上的 pxectl 做（控制台不碰 Docker）：页面把升级包存进 data/system/updates/，
 * 写一个 update-request.json，宿主机的 systemd 看到后验签、备份、换镜像、检查，失败自动回滚，进度写回 update-status.json。
 */

export const BACKUP_FORMAT = 1;
const MANIFEST = "pxe-backup.json";

/** 大目录：只有完整备份才带，只带配置的备份恢复时不动它们。 */
export const LARGE_ENTRIES = ["images", "firmware", "diag", "log-bundles"];
/** 从不进备份，恢复时也不动：数据库单独拍快照；备份、升级包和恢复用的临时目录；上传到一半的文件。 */
const NEVER = new Set(["pxe.db", "pxe.db-wal", "pxe.db-shm", "backups", "system", ".restore", "uploads", "incoming", "extract.lock"]);

export interface BackupManifest {
  format: number;
  version: string;
  dbVersion: number;
  createdAt: string;
  hostname: string;
  full: boolean;
  reason: string;
  actor: string;
  /** 备份里有的顶层条目（不含 pxe.db）。 */
  entries: string[];
  /** 解开后大约多大，恢复前按它查空间。 */
  bytes: number;
}

export interface BackupInfo {
  name: string;
  size: number;
  manifest: BackupManifest | null;
}

export interface BackupJob {
  state: "running" | "done" | "error";
  full: boolean;
  reason: string;
  actor: string;
  startedAt: string;
  finishedAt?: string;
  name?: string;
  error?: string;
}

export function consoleVersion(): string {
  return process.env.PXE_VERSION || "dev";
}

export function backupsDir(): string {
  return path.join(dataDir(), "backups");
}

export function systemDir(): string {
  return path.join(dataDir(), "system");
}

function restoreDir(): string {
  return path.join(dataDir(), ".restore");
}

const BACKUP_NAME = /^pxe-backup-[A-Za-z0-9._-]{1,120}\.tar\.(zst|gz)$/;
const UPDATE_NAME = /^pxe-[A-Za-z0-9._-]{1,120}\.run$/;

export function isBackupName(name: string): boolean {
  return BACKUP_NAME.test(name);
}

export function backupPath(name: string): string {
  if (!isBackupName(name)) throw new Error("备份文件名不对");
  return path.join(backupsDir(), name);
}

function stamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 有任务在跑或镜像在解包时不能恢复、升级：重启控制台会把它们打断。 */
export function busyReason(): string {
  const extracting = listImages().filter((image) => image.status === "extracting");
  if (extracting.length) return `镜像 ${extracting.map((image) => image.name).join("、")} 正在解包`;
  const running = listAllTasks().filter((task) => task.status === "running");
  if (running.length) return `任务 ${running.map((task) => task.name).slice(0, 3).join("、")} 正在执行`;
  return "";
}

function dirBytes(target: string): number {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop()!;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current)) stack.push(path.join(current, name));
    } else total += stat.size;
  }
  return total;
}

function freeBytes(dir: string): number {
  const stat = fs.statfsSync(dir);
  return Number(stat.bavail) * Number(stat.bsize);
}

function run(command: string, args: string[], options: { cwd?: string } = {}): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 1_000_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 20_000) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function compressFlag(name: string): string[] {
  return name.endsWith(".gz") ? ["-z"] : ["-I", "zstd -T0 -3 -q"];
}

function writeSidecar(file: string, manifest: BackupManifest): void {
  fs.writeFileSync(`${file}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

// ---------- 备份 ----------

/** 做一份备份，返回文件名。full 为 true 时连镜像、固件包一起备。 */
export async function makeBackup(options: { full: boolean; reason: string; actor: string }): Promise<string> {
  const root = dataDir();
  fs.mkdirSync(backupsDir(), { recursive: true, mode: 0o700 });
  const entries = fs
    .readdirSync(root)
    .filter((name) => !NEVER.has(name) && !name.startsWith(".") && (options.full || !LARGE_ENTRIES.includes(name)))
    .sort();
  const temp = fs.mkdtempSync(path.join(backupsDir(), ".make-"));
  try {
    // VACUUM INTO 给出一份完整、一致的库文件，不带 WAL，备份时控制台照常读写。
    db().exec(`VACUUM INTO '${path.join(temp, "pxe.db").replace(/'/g, "''")}'`);
    const bytes = fs.statSync(path.join(temp, "pxe.db")).size + entries.reduce((sum, name) => sum + dirBytes(path.join(root, name)), 0);
    const need = bytes * (options.full ? 1 : 0.6) + 512 * 1024 * 1024;
    if (freeBytes(backupsDir()) < need) throw new Error(`磁盘空间不够：这份备份约 ${(bytes / 1024 ** 3).toFixed(1)} GB`);
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: consoleVersion(),
      dbVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      hostname: process.env.PXE_HOSTNAME || os.hostname(),
      full: options.full,
      reason: options.reason,
      actor: options.actor,
      entries,
      bytes,
    };
    fs.writeFileSync(path.join(temp, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    // 带个随机尾巴：同一秒里做两份（比如恢复前的自动备份）也不会互相覆盖。
    const name = `pxe-backup-${stamp()}-${options.full ? "full" : "data"}-${crypto.randomBytes(2).toString("hex")}.tar.zst`;
    const partial = path.join(temp, name);
    // 清单放第一个，读清单时不用解整个包。
    const args = ["-c", ...compressFlag(name), "-f", partial, "--warning=no-file-changed", "--ignore-failed-read", "-C", temp, MANIFEST, "pxe.db"];
    if (entries.length) args.push("-C", root, ...entries);
    const result = await run("tar", args);
    // 1 是「文件在打包时变了」，监控、任务日志一直在写，算正常。
    if (result.code > 1) throw new Error(`打包失败：${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
    const final = path.join(backupsDir(), name);
    fs.chmodSync(partial, 0o600);
    fs.renameSync(partial, final);
    writeSidecar(final, manifest);
    return name;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

declare global {
  var pxeBackupJob: BackupJob | undefined;
}

/** 在后台做备份（完整备份带镜像，要几分钟），页面轮询 currentBackupJob。 */
export function startBackup(options: { full: boolean; reason: string; actor: string }): BackupJob {
  if (globalThis.pxeBackupJob?.state === "running") throw new Error("已经有一份备份在做");
  const job: BackupJob = { state: "running", full: options.full, reason: options.reason, actor: options.actor, startedAt: new Date().toISOString() };
  globalThis.pxeBackupJob = job;
  makeBackup(options).then(
    (name) => Object.assign(job, { state: "done", name, finishedAt: new Date().toISOString() }),
    (error: unknown) => Object.assign(job, { state: "error", error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() }),
  );
  return job;
}

export function currentBackupJob(): BackupJob | null {
  return globalThis.pxeBackupJob || null;
}

/** 读备份里的清单：有旁边的 .json 就用它，没有（外面传进来的）就从包里取第一个文件。 */
export async function readManifest(file: string): Promise<BackupManifest> {
  const sidecar = `${file}.json`;
  if (fs.existsSync(sidecar)) return JSON.parse(fs.readFileSync(sidecar, "utf8")) as BackupManifest;
  const result = await run("tar", ["-x", ...compressFlag(file), "-O", "-f", file, "--occurrence=1", MANIFEST]);
  if (result.code !== 0 || !result.stdout.trim()) throw new Error("这不是控制台导出的备份（包里没有 pxe-backup.json）");
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(result.stdout) as BackupManifest;
  } catch {
    throw new Error("备份里的清单读不出来");
  }
  if (manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.entries)) throw new Error("备份格式不认识");
  writeSidecar(file, manifest);
  return manifest;
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(backupsDir())) return [];
  return fs
    .readdirSync(backupsDir())
    .filter(isBackupName)
    .map((name) => {
      const file = path.join(backupsDir(), name);
      let manifest: BackupManifest | null = null;
      try {
        manifest = JSON.parse(fs.readFileSync(`${file}.json`, "utf8")) as BackupManifest;
      } catch {
        manifest = null;
      }
      return { name, size: fs.statSync(file).size, manifest };
    })
    .sort((a, b) => (b.manifest?.createdAt || b.name).localeCompare(a.manifest?.createdAt || a.name));
}

export function deleteBackup(name: string): void {
  const file = backupPath(name);
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.json`, { force: true });
}

/** 自动做的备份（升级前、恢复前）每种只留最近几份，免得占满盘。手动做的不删。 */
export function pruneAutoBackups(reason: string, keep = 5): void {
  for (const item of listBackups().filter((backup) => backup.manifest?.reason === reason && backup.manifest.actor === "系统").slice(keep)) {
    deleteBackup(item.name);
  }
}

/** 收一份上传的备份：先写临时文件，确认是备份再改成正式名字。 */
export async function receiveBackup(filename: string, body: ReadableStream<Uint8Array>): Promise<BackupInfo> {
  fs.mkdirSync(backupsDir(), { recursive: true, mode: 0o700 });
  const ext = filename.endsWith(".tar.gz") || filename.endsWith(".tgz") ? "tar.gz" : "tar.zst";
  const temp = path.join(backupsDir(), `.upload-${crypto.randomUUID()}.${ext}`);
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), fs.createWriteStream(temp, { mode: 0o600 }));
    const manifest = await readManifest(temp);
    const name = `pxe-backup-${stamp(new Date(manifest.createdAt))}-${manifest.full ? "full" : "data"}-${crypto.randomBytes(2).toString("hex")}.${ext}`;
    const final = path.join(backupsDir(), name);
    fs.renameSync(temp, final);
    fs.renameSync(`${temp}.json`, `${final}.json`);
    return { name, size: fs.statSync(final).size, manifest };
  } finally {
    fs.rmSync(temp, { force: true });
    fs.rmSync(`${temp}.json`, { force: true });
  }
}

// ---------- 恢复 ----------

interface PendingRestore {
  name: string;
  manifest: BackupManifest;
  actor: string;
  stagedAt: string;
}

export interface RestoreResult {
  name: string;
  ok: boolean;
  at: string;
  message: string;
  actor: string;
}

/**
 * 把备份解到暂存目录，等控制台重启时换进去。先自动做一份「恢复前」备份，恢复错了还能回去。
 * 返回后由调用方重启控制台（页面上是让进程退出，Docker 会拉起来；pxectl 是 docker compose restart）。
 */
export async function stageRestore(name: string, actor: string): Promise<BackupManifest> {
  const busy = busyReason();
  if (busy) throw new Error(`${busy}，等它结束再恢复`);
  const file = backupPath(name);
  if (!fs.existsSync(file)) throw new Error("备份不存在");
  const manifest = await readManifest(file);
  if (manifest.dbVersion > SCHEMA_VERSION) throw new Error(`这份备份来自更新的版本（${manifest.version}），先把控制台升级到这个版本或更新再恢复`);
  const free = freeBytes(dataDir());
  if (free < manifest.bytes + 512 * 1024 * 1024) throw new Error(`磁盘空间不够：解开要约 ${(manifest.bytes / 1024 ** 3).toFixed(1)} GB，现在剩 ${(free / 1024 ** 3).toFixed(1)} GB`);

  await makeBackup({ full: false, reason: "恢复前", actor: "系统" });
  pruneAutoBackups("恢复前");

  fs.rmSync(restoreDir(), { recursive: true, force: true });
  const stage = path.join(restoreDir(), "stage");
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  // GNU tar 默认会去掉开头的 /、拒绝带 .. 的路径，不会写到暂存目录外面。
  const result = await run("tar", ["-x", ...compressFlag(file), "-f", file, "-C", stage, "--no-same-owner"]);
  if (result.code !== 0) {
    fs.rmSync(restoreDir(), { recursive: true, force: true });
    throw new Error(`解包失败：${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
  }
  if (!fs.existsSync(path.join(stage, "pxe.db"))) {
    fs.rmSync(restoreDir(), { recursive: true, force: true });
    throw new Error("备份里没有数据库");
  }
  const pending: PendingRestore = { name, manifest, actor, stagedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(restoreDir(), "pending.json"), JSON.stringify(pending));
  return manifest;
}

function restoreResultPath(): string {
  return path.join(systemDir(), "restore-result.json");
}

export function lastRestoreResult(): RestoreResult | null {
  try {
    return JSON.parse(fs.readFileSync(restoreResultPath(), "utf8")) as RestoreResult;
  } catch {
    return null;
  }
}

/**
 * 控制台启动时最先调：有暂存好的恢复就换进 data/。
 * 备份里有的顶层条目整个替换；备份里没有、又不是「只配置备份不带的大目录」的也挪走，恢复后和备份时一致。
 * 中途出错把挪走的放回去，不会留下半新半旧的数据。不管成败都删掉 pending，免得每次启动都重来。
 */
export function applyPendingRestore(): RestoreResult | null {
  const pendingFile = path.join(restoreDir(), "pending.json");
  if (!fs.existsSync(pendingFile)) return null;
  const root = dataDir();
  const stage = path.join(restoreDir(), "stage");
  const old = path.join(restoreDir(), "old");
  let pending: PendingRestore | null = null;
  const moved: { from: string; to: string }[] = [];
  const move = (from: string, to: string) => {
    fs.renameSync(from, to);
    moved.push({ from, to });
  };
  let result: RestoreResult;
  try {
    pending = JSON.parse(fs.readFileSync(pendingFile, "utf8")) as PendingRestore;
    const manifest = pending.manifest;
    const keep = new Set([...NEVER, ...(manifest.full ? [] : LARGE_ENTRIES)]);
    fs.mkdirSync(old, { recursive: true });
    for (const name of ["pxe.db", "pxe.db-wal", "pxe.db-shm"]) {
      if (fs.existsSync(path.join(root, name))) move(path.join(root, name), path.join(old, name));
    }
    for (const name of fs.readdirSync(root)) {
      if (keep.has(name) || name.startsWith(".")) continue;
      move(path.join(root, name), path.join(old, name));
    }
    move(path.join(stage, "pxe.db"), path.join(root, "pxe.db"));
    for (const name of manifest.entries) {
      if (keep.has(name) || name.includes("/") || name.startsWith(".")) continue;
      const from = path.join(stage, name);
      if (fs.existsSync(from)) move(from, path.join(root, name));
    }
    result = { name: pending.name, ok: true, at: new Date().toISOString(), actor: pending.actor, message: `已恢复到 ${pending.manifest.createdAt} 的备份（${manifest.full ? "完整" : "只含数据和配置"}）` };
  } catch (error) {
    for (const { from, to } of moved.reverse()) {
      try {
        fs.renameSync(to, from);
      } catch {
        // 放不回去的留在 .restore/old 里，下面不删它。
      }
    }
    result = { name: pending?.name || "", ok: false, at: new Date().toISOString(), actor: pending?.actor || "", message: `恢复失败，数据没动：${error instanceof Error ? error.message : String(error)}` };
  }
  fs.rmSync(pendingFile, { force: true });
  fs.rmSync(stage, { recursive: true, force: true });
  if (result.ok) fs.rmSync(restoreDir(), { recursive: true, force: true });
  fs.mkdirSync(systemDir(), { recursive: true });
  fs.writeFileSync(restoreResultPath(), JSON.stringify(result));
  return result;
}

/** 让控制台退出，Docker 按 restart: unless-stopped 拉起来；先等响应发出去。 */
export function restartConsoleSoon(delayMs = 1500): void {
  setTimeout(() => process.exit(0), delayMs).unref?.();
}

// ---------- 升级 ----------

export interface HostAgent {
  /** pxectl 的版本，装了宿主机升级服务才有。 */
  pxectl: string;
  home: string;
  installedAt: string;
}

export interface VersionHistory {
  current: string;
  previous: string;
  history: { version: string; at: string; by: string; result: string }[];
}

export interface UpdateStatus {
  state: "idle" | "queued" | "running" | "done" | "failed" | "rolled-back";
  file?: string;
  from?: string;
  to?: string;
  step?: string;
  message?: string;
  requestedBy?: string;
  updatedAt?: string;
  log?: string;
}

export interface UpdateBundle {
  file: string;
  size: number;
  version: string;
  builtAt: string;
  withDocker: boolean;
  signed: boolean;
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function updatesDir(): string {
  return path.join(systemDir(), "updates");
}

export function hostAgent(): HostAgent | null {
  return readJsonFile<HostAgent>(path.join(systemDir(), "agent.json"));
}

export function versionHistory(): VersionHistory | null {
  return readJsonFile<VersionHistory>(path.join(systemDir(), "version.json"));
}

export function updateStatus(): UpdateStatus {
  const status = readJsonFile<UpdateStatus>(path.join(systemDir(), "update-status.json")) || { state: "idle" };
  if (fs.existsSync(path.join(systemDir(), "update-request.json")) && !["running"].includes(status.state)) return { ...status, state: "queued" };
  const logFile = path.join(systemDir(), "update.log");
  if (fs.existsSync(logFile)) {
    const text = fs.readFileSync(logFile, "utf8");
    status.log = text.length > 20000 ? text.slice(-20000) : text;
  }
  return status;
}

/** 升级包开头是一段 shell，里面有 PXE_RELEASE_* 几行，读出来给页面显示；真正的校验和验签在宿主机上做。 */
export function readBundleHeader(file: string): UpdateBundle {
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(16384);
  const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  const head = buffer.subarray(0, read).toString("latin1");
  const field = (key: string) => head.match(new RegExp(`^${key}=['"]?([^'"\\n]*)`, "m"))?.[1] || "";
  const version = field("PXE_RELEASE_VERSION");
  if (!head.startsWith("#!") || !version) throw new Error("这不是控制台的升级包（.run）");
  return {
    file: path.basename(file),
    size: fs.statSync(file).size,
    version,
    builtAt: field("PXE_RELEASE_BUILT"),
    withDocker: field("PXE_RELEASE_DOCKER") === "1",
    signed: Boolean(field("PXE_RELEASE_SIG")),
  };
}

export function listUpdateBundles(): UpdateBundle[] {
  if (!fs.existsSync(updatesDir())) return [];
  const out: UpdateBundle[] = [];
  for (const name of fs.readdirSync(updatesDir())) {
    if (!UPDATE_NAME.test(name)) continue;
    try {
      out.push(readBundleHeader(path.join(updatesDir(), name)));
    } catch {
      // 不认识的文件不列出来。
    }
  }
  return out.sort((a, b) => b.builtAt.localeCompare(a.builtAt));
}

export async function receiveUpdateBundle(filename: string, body: ReadableStream<Uint8Array>): Promise<UpdateBundle> {
  const base = path.basename(filename);
  if (!UPDATE_NAME.test(base)) throw new Error("升级包的文件名应该是 pxe-<版本>.run，别改名");
  fs.mkdirSync(updatesDir(), { recursive: true, mode: 0o700 });
  const temp = path.join(updatesDir(), `.upload-${crypto.randomUUID()}`);
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), fs.createWriteStream(temp, { mode: 0o600 }));
    const info = readBundleHeader(temp);
    fs.renameSync(temp, path.join(updatesDir(), base));
    return { ...info, file: base };
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function deleteUpdateBundle(file: string): void {
  if (!UPDATE_NAME.test(file)) throw new Error("文件名不对");
  fs.rmSync(path.join(updatesDir(), file), { force: true });
}

/** 交给宿主机升级：写请求文件，systemd 的 pxe-update.path 看到就开始。 */
export function requestUpdate(file: string, actor: string): UpdateStatus {
  if (!UPDATE_NAME.test(file) || !fs.existsSync(path.join(updatesDir(), file))) throw new Error("升级包不存在");
  if (!hostAgent()) throw new Error("这台机器不是用安装包装的（没有宿主机升级服务），只能在命令行升级");
  const status = updateStatus();
  if (status.state === "queued" || status.state === "running") throw new Error("已经有一次升级在进行");
  const busy = busyReason();
  if (busy) throw new Error(`${busy}，等它结束再升级`);
  const request = { file, requestedBy: actor, at: new Date().toISOString() };
  fs.writeFileSync(path.join(systemDir(), ".update-request.tmp"), JSON.stringify(request));
  fs.renameSync(path.join(systemDir(), ".update-request.tmp"), path.join(systemDir(), "update-request.json"));
  return { state: "queued", file, requestedBy: actor, updatedAt: request.at };
}

/** 「系统」页要的全部状态，页面首屏和轮询共用。 */
export function systemOverview() {
  return {
    version: consoleVersion(),
    agent: hostAgent(),
    history: versionHistory(),
    update: updateStatus(),
    bundles: listUpdateBundles(),
    backups: listBackups(),
    job: currentBackupJob(),
    restore: lastRestoreResult(),
    busy: busyReason(),
  };
}
