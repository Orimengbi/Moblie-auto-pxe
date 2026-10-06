import fs from "node:fs";
import path from "node:path";
import { isoSuffix } from "./iso-name.ts";
import { createImageFromIncoming } from "./store.ts";
import type { ImageRecord } from "./types.ts";
import { ensureDataDirs, incomingDir, uploadDir } from "./paths.ts";

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

function metaPath(id: string): string {
  return path.join(uploadDir(id), "meta.json");
}

function partPath(id: string): string {
  return path.join(uploadDir(id), "part.bin");
}

function readSession(id: string): UploadSession | null {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) return null;
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
  const dir = path.dirname(uploadDir("x"));
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
  if (!isoSuffix(filename)) throw new Error("只能上传 .iso 或压缩过的 ISO（.iso.xz、.iso.gz、.iso.zst、.iso.bz2）");
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_ISO) throw new Error("ISO 大小不合法");
  const fingerprint = input.fingerprint.trim();
  if (fingerprint.length < 3 || fingerprint.length > 240) throw new Error("上传标识不合法");
  const existing = listUploadSessions().find((item) => item.fingerprint === fingerprint && item.size === input.size && item.offset < item.size);
  if (existing) {
    if (input.name?.trim()) existing.name = input.name.trim().slice(0, 80);
    writeSession(existing);
    return existing;
  }
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
