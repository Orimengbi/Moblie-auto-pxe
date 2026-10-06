"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

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
const FLOAT_KEY = "pxe-upload-float";

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
      <UploadFloat />
    </UploadContext.Provider>
  );
}

/** 离开镜像页时，把这次经手的上传缩成一个能拖动的小窗。 */
function UploadFloat() {
  const pathname = usePathname();
  const uploads = useUploads();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const tasks = Object.values(uploads.live);
  const visible = !pathname.startsWith("/images") && tasks.length > 0;

  const clamp = useCallback((x: number, y: number) => {
    const width = box.current?.offsetWidth || 288;
    const height = box.current?.offsetHeight || 120;
    return {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let saved: { x: number; y: number } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(FLOAT_KEY) || "null");
    } catch {
      saved = null;
    }
    const width = box.current?.offsetWidth || 288;
    const height = box.current?.offsetHeight || 120;
    setPos(clamp(saved?.x ?? window.innerWidth - width - 16, saved?.y ?? window.innerHeight - height - 16));
    const onResize = () => setPos((current) => (current ? clamp(current.x, current.y) : current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [visible, clamp]);

  if (!visible) return null;

  return (
    <div
      ref={box}
      className="fixed z-50 grid w-72 gap-2 rounded-xl bg-card p-3 text-sm shadow-lg ring-1 ring-foreground/10"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }}
    >
      <div
        className="-m-3 mb-0 flex cursor-move touch-none items-center justify-between rounded-t-xl bg-muted/60 px-3 py-1.5 select-none"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("a,button")) return;
          const rect = box.current!.getBoundingClientRect();
          drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPos(clamp(event.clientX - drag.current.dx, event.clientY - drag.current.dy));
        }}
        onPointerUp={() => {
          drag.current = null;
          try {
            if (pos) localStorage.setItem(FLOAT_KEY, JSON.stringify(pos));
          } catch {
            // 存不了位置也照样能用，只是下次回到默认位置。
          }
        }}
      >
        <span className="text-xs font-medium">镜像上传</span>
        <Link href="/images" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          打开镜像页
        </Link>
      </div>
      {tasks.map((item) => (
        <div key={item.id} className="grid gap-1 pt-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium" title={item.filename}>
              {item.name || item.filename}
            </span>
            <span className={`shrink-0 text-xs ${item.state === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {item.state === "running" ? `${percent(item.offset, item.size)}%` : item.state === "done" ? "已传完" : item.state === "error" ? "已中断" : "已暂停"}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${item.state === "running" || item.state === "done" ? "bg-primary" : "bg-muted-foreground/40"}`}
              style={{ width: `${percent(item.offset, item.size)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {item.state === "done" ? "后台正在识别和抽取" : `${formatBytes(item.offset)} / ${formatBytes(item.size)}`}
          </p>
          {item.error ? <p className="text-xs text-destructive">{item.error}</p> : null}
          <div className="flex justify-end gap-1">
            {item.state === "running" ? (
              <Button type="button" variant="secondary" size="sm" onClick={uploads.pause}>
                暂停
              </Button>
            ) : item.state !== "done" && uploads.hasFile(item.id) ? (
              <Button type="button" variant="secondary" size="sm" disabled={uploads.running} onClick={() => uploads.resume(item.id)}>
                继续
              </Button>
            ) : null}
            {item.state === "done" ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => uploads.dismiss(item.id)}>
                关闭
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (!window.confirm(`取消上传 ${item.name || item.filename}？已经传上去的部分会删除。`)) return;
                  const failed = await uploads.cancel(item);
                  if (failed) window.alert(failed);
                }}
              >
                取消
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
