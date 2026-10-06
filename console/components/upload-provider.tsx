"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface PendingUpload {
  id: string;
  filename: string;
  name: string;
  size: number;
  offset: number;
  fingerprint: string;
  updatedAt: string;
}

export type TaskState = "running" | "paused" | "error" | "done";

/** 这次打开页面以来经手的上传。文件对象在这里，换页面不会丢；整页刷新才会丢。 */
export interface LiveUpload extends PendingUpload {
  state: TaskState;
  error?: string;
}

interface UploadApi {
  live: Record<string, LiveUpload>;
  running: boolean;
  hasFile: (id: string) => boolean;
  /** 新传一个文件，或者传入原来的会话接着传。 */
  run: (file: File, name: string) => void;
  resume: (id: string) => boolean;
  pause: () => void;
  cancel: (item: PendingUpload) => Promise<string | null>;
  dismiss: (id: string) => void;
}

const UploadContext = createContext<UploadApi | null>(null);

const CHUNK = 4 * 1024 * 1024;
const RETRIES = 5;

class Paused extends Error {}

export function fingerprintOf(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function percent(offset: number, size: number): number {
  return size ? Math.floor((offset / size) * 100) : 0;
}

export function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export function useUploads(): UploadApi {
  const api = useContext(UploadContext);
  if (!api) throw new Error("useUploads 要放在 UploadProvider 里");
  return api;
}

/** 发一段。网络断开或控制台 5xx 时等一会再试；服务器说位置不对时按它的位置继续。 */
async function sendChunk(id: string, selected: File, offset: number, signal: AbortSignal): Promise<{ offset: number; done: boolean }> {
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    if (signal.aborted) throw new Paused();
    let response: Response;
    try {
      response = await fetch(`/api/images/uploads/${id}`, {
        method: "PATCH",
        headers: { "upload-offset": String(offset), "content-type": "application/octet-stream" },
        body: selected.slice(offset, Math.min(offset + CHUNK, selected.size)),
        signal,
      });
    } catch {
      if (signal.aborted) throw new Paused();
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && Number.isInteger(body.offset)) return { offset: body.offset, done: false };
    if (response.status >= 500) continue;
    if (!response.ok) throw new Error(body.error || "上传中断");
    return { offset: body.offset, done: Boolean(body.image) };
  }
  throw new Error(`网络断开，重试 ${RETRIES} 次都没成功`);
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [live, setLive] = useState<Record<string, LiveUpload>>({});
  const files = useRef(new Map<string, File>());
  const abort = useRef<AbortController | null>(null);
  const running = Object.values(live).some((item) => item.state === "running");

  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const patch = useCallback((id: string, change: Partial<LiveUpload>) => {
    setLive((current) => (current[id] ? { ...current, [id]: { ...current[id], ...change } } : current));
  }, []);

  const run = useCallback(
    async (selected: File, name: string) => {
      if (abort.current) return;
      const controller = new AbortController();
      abort.current = controller;
      let id = "";
      try {
        const opened = await fetch("/api/images/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: selected.name, size: selected.size, name, fingerprint: fingerprintOf(selected) }),
        });
        const session = await opened.json();
        if (!opened.ok) throw new Error(session.error || "无法开始上传");
        id = session.id;
        files.current.set(id, selected);
        let offset = Number(session.offset) || 0;
        const task: LiveUpload = { id, filename: session.filename, name: session.name, size: session.size, offset, fingerprint: session.fingerprint, updatedAt: session.updatedAt, state: "running" };
        setLive((current) => ({ ...current, [id]: task }));
        while (offset < selected.size) {
          const sent = await sendChunk(id, selected, offset, controller.signal);
          offset = sent.offset;
          patch(id, { offset, updatedAt: new Date().toISOString() });
          if (sent.done) break;
        }
        files.current.delete(id);
        patch(id, { state: "done", offset: selected.size });
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : "上传中断";
        if (!id) {
          // 会话都没开起来，就挂一个临时任务把原因显示出来。
          id = `failed-${Date.now()}`;
          const failed: LiveUpload = { id, filename: selected.name, name, size: selected.size, offset: 0, fingerprint: fingerprintOf(selected), updatedAt: new Date().toISOString(), state: "error", error: message };
          setLive((current) => ({ ...current, [id]: failed }));
        } else if (uploadError instanceof Paused) {
          patch(id, { state: "paused", error: undefined });
        } else {
          patch(id, { state: "error", error: message });
        }
      } finally {
        abort.current = null;
        router.refresh();
      }
    },
    [patch, router],
  );

  const api: UploadApi = {
    live,
    running,
    hasFile: (id) => files.current.has(id),
    run: (file, name) => void run(file, name),
    resume: (id) => {
      const file = files.current.get(id);
      if (!file) return false;
      void run(file, live[id]?.name || "");
      return true;
    },
    pause: () => abort.current?.abort(),
    cancel: async (item) => {
      if (live[item.id]?.state === "running") abort.current?.abort();
      if (!item.id.startsWith("failed-")) {
        const response = await fetch(`/api/images/uploads/${item.id}`, { method: "DELETE" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 404) return body.error || "取消失败";
      }
      files.current.delete(item.id);
      setLive((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      router.refresh();
      return null;
    },
    dismiss: (id) =>
      setLive((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      }),
  };

  return (
    <UploadContext.Provider value={api}>
      {children}
    </UploadContext.Provider>
  );
}
