import fs from "node:fs";
import path from "node:path";
import { ISO_FORMATS_LABEL, isoSuffix } from "./iso-name.ts";
import { createImageFromIncoming, listImages } from "./store.ts";
import type { ImageRecord } from "./types.ts";
import { ensureDataDirs, incomingDir, uploadDir, isSafeId, dataDir } from "./paths.ts";

export interface UploadSession {
  id: string;
  filename: string;
  name: string;
  size: number;
  offset: number;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export class UploadConflict extends Error {
  offset: number;
  constructor(offset: number) {
    super(`上传位置不一致，服务器已经收到 ${offset} 字节`);
    this.offset = offset;
  }
}

const MAX_ISO = 64 * 1024 * 1024 * 1024;
/** 上传完还要解压一份、留点给数据库和日志，所以收完这次上传后至少还要剩这么多。 */
const FREE_RESERVE = 2 * 1024 * 1024 * 1024;

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * 解包时还要额外占多少（源文件本身已经在盘上，不算）：
 * 网络安装 ISO 展开安装树 ≈ 再来一份；整盘镜像先 dd 出根分区（≤ 整盘）再压缩，根分区和压缩包同时在，≈ 再来 1.4 份。
 */
export type ExtractKind = "tree" | "disk";
const EXTRA_FACTOR: Record<ExtractKind, number> = { tree: 1, disk: 1.4 };

export function extractKind(filename: string): ExtractKind {
  return isoSuffix(filename)?.startsWith(".img") ? "disk" : "tree";
}

function extraBytes(kind: ExtractKind, size: number): number {
  return Math.ceil(size * EXTRA_FACTOR[kind]);
}

function peakLabel(kind: ExtractKind): string {
  return kind === "disk" ? "整盘镜像导入时峰值约 2.4 倍" : "展开安装树时峰值约 2 倍";
}

/** 还在排队或正在解包的镜像，解包时还要多占的空间（正在跑的那个有一部分已经占了，这里按全量算，偏保守）。 */
export function queuedExtractBytes(images = listImages()): number {
  return images
    .filter((image) => image.status === "extracting")
    .reduce((sum, image) => sum + extraBytes(extractKind(image.filename), image.size || 0), 0);
}

/**
 * 数据盘放不下这次上传（加上其他没传完的、排队解包的、再加上传完解包的峰值）就直接拒绝，别传到一半或解包到一半把盘写满。
 * 压缩包按压缩后的大小估，偏小；解包任务里拿到真实大小还会再查一次（assertExtractFits）。
 */
export function assertUploadFits(size: number, pending: UploadSession[], free = diskFree(), kind: ExtractKind = "tree", queued = 0): void {
  const owed = pending.reduce((sum, item) => sum + Math.max(0, item.size - item.offset), 0);
  const need = size + extraBytes(kind, size);
  if (need + owed + queued + FREE_RESERVE > free) {
    const others = [owed && `其他没传完的上传还要 ${gb(owed)}`, queued && `排队解包的镜像还要 ${gb(queued)}`].filter(Boolean).map((text) => `，${text}`).join("");
    throw new Error(`数据盘空间不够：这个文件 ${gb(size)}，${peakLabel(kind)}要 ${gb(need)}${others}，盘上只剩 ${gb(free)}（要留 ${gb(FREE_RESERVE)} 余量）`);
  }
}

/** 解包前按峰值再查一次（拿着解包锁查，前面的都跑完了）：源文件已经在盘上，只看还要多占的部分。 */
export function assertExtractFits(kind: ExtractKind, size: number, free = diskFree()): void {
  const extra = extraBytes(kind, size);
  if (extra + FREE_RESERVE > free) {
    throw new Error(`数据盘空间不够：源文件 ${gb(size)}，${peakLabel(kind)}，还要再占 ${gb(extra)}，盘上只剩 ${gb(free)}（要留 ${gb(FREE_RESERVE)} 余量）。删掉不用的镜像后重新导入`);
  }
}

function diskFree(): number {
  const stat = fs.statfsSync(dataDir());
  return stat.bavail * stat.bsize;
}

function metaPath(id: string): string {
  return path.join(uploadDir(id), "meta.json");
}

function partPath(id: string): string {
  return path.join(uploadDir(id), "part.bin");
}

function readSession(id: string): UploadSession | null {
  if (!isSafeId(id)) return null;
  const file = metaPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as UploadSession;
}

function writeSession(session: UploadSession): void {
  fs.mkdirSync(uploadDir(session.id), { recursive: true });
  fs.writeFileSync(metaPath(session.id), `${JSON.stringify(session, null, 2)}\n`);
}

function repairOffset(session: UploadSession): UploadSession {
  const part = partPath(session.id);
  const size = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (size === session.offset) return session;
  session.offset = Math.min(size, session.size);
  session.updatedAt = new Date().toISOString();
  writeSession(session);
  return session;
}

export function listUploadSessions(): UploadSession[] {
  ensureDataDirs();
  const dir = path.join(dataDir(), "uploads");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => readSession(name))
    .filter((item): item is UploadSession => Boolean(item))
    .map(repairOffset);
}

function safeIsoName(filename: string, id: string): string {
  const base = path.basename(filename).replace(/[^\w.\-()+ ]+/g, "_");
  const suffix = isoSuffix(base);
  const withExt = suffix ? base : `${base}.iso`;
  const target = path.join(incomingDir(), withExt);
  if (!fs.existsSync(target)) return withExt;
  const ext = suffix || ".iso";
  return `${withExt.slice(0, -ext.length)}-${id.slice(0, 8)}${ext}`;
}

export function openUpload(input: { filename: string; size: number; name?: string; fingerprint: string }): UploadSession {
  ensureDataDirs();
  const filename = path.basename(input.filename);
  if (!isoSuffix(filename)) throw new Error(`只能上传 ${ISO_FORMATS_LABEL}`);
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_ISO) throw new Error("ISO 大小不合法");
  const fingerprint = input.fingerprint.trim();
  if (fingerprint.length < 3 || fingerprint.length > 240) throw new Error("上传标识不合法");
  const existing = listUploadSessions().find((item) => item.fingerprint === fingerprint && item.size === input.size && item.offset < item.size);
  if (existing) {
    if (input.name?.trim()) existing.name = input.name.trim().slice(0, 80);
    writeSession(existing);
    return existing;
  }
  assertUploadFits(input.size, listUploadSessions(), undefined, extractKind(filename), queuedExtractBytes());
  const now = new Date().toISOString();
  const session: UploadSession = {
    id: crypto.randomUUID(),
    filename: safeIsoName(filename, crypto.randomUUID()),
    name: (input.name || "").trim().slice(0, 80),
    size: input.size,
    offset: 0,
    fingerprint,
    createdAt: now,
    updatedAt: now,
  };
  fs.mkdirSync(uploadDir(session.id), { recursive: true });
  fs.writeFileSync(partPath(session.id), Buffer.alloc(0));
  writeSession(session);
  return session;
}

export function discardUpload(id: string): void {
  if (!readSession(id)) throw new Error("上传不存在或已经完成");
  fs.rmSync(uploadDir(id), { recursive: true, force: true });
}

export function uploadStatus(id: string): UploadSession {
  const session = readSession(id);
  if (!session) throw new Error("上传不存在或已经完成");
  return repairOffset(session);
}

export async function appendUpload(id: string, offset: number, bytes: Buffer): Promise<{ session: UploadSession; image: ImageRecord | null }> {
  const session = uploadStatus(id);
  if (offset !== session.offset) throw new UploadConflict(session.offset);
  if (session.offset + bytes.length > session.size) throw new Error("这一段超出了 ISO 的大小");
  const file = fs.openSync(partPath(id), "r+");
  try {
    fs.writeSync(file, bytes, 0, bytes.length, offset);
  } finally {
    fs.closeSync(file);
  }
  session.offset += bytes.length;
  session.updatedAt = new Date().toISOString();
  writeSession(session);
  if (session.offset < session.size) return { session, image: null };
  const dest = path.join(incomingDir(), session.filename);
  fs.renameSync(partPath(id), dest);
  const image = await createImageFromIncoming({ filename: session.filename, name: session.name });
  fs.rmSync(uploadDir(id), { recursive: true, force: true });
  return { session, image };
}
