"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, percent, useUploads, type LiveUpload } from "@/components/upload-provider";
import type { TaskFeed, TaskSummary } from "@/lib/types";

type FloatKind = "upload" | "batch";
type FloatPrefs = Record<FloatKind, boolean>;

const FLOAT_KEY = "pxe-upload-float";
const PREFS_KEY = "pxe-task-float-kinds";
// 小浮窗默认都关着，要的话在任务列表里勾上。
const DEFAULT_PREFS: FloatPrefs = { upload: false, batch: false };
const EMPTY: TaskFeed = { tasks: [], extracting: [], uploads: [] };

function loadPrefs(): FloatPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

function Bar({ value, active }: { value: number; active: boolean }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className={`h-full transition-all ${active ? "bg-primary" : "bg-muted-foreground/40"}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function UploadItem({ item }: { item: LiveUpload }) {
  const uploads = useUploads();
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={item.filename}>
          {item.name || item.filename}
        </span>
        <span className={`shrink-0 text-xs ${item.state === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {item.state === "running" ? `${percent(item.offset, item.size)}%` : item.state === "done" ? "已传完" : item.state === "error" ? "已中断" : "已暂停"}
        </span>
      </div>
      <Bar value={percent(item.offset, item.size)} active={item.state === "running" || item.state === "done"} />
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
        ) : item.state !== "done" ? (
          <Link href="/images" className="px-2 py-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
            到镜像页选文件继续
          </Link>
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
  );
}

function BatchItem({ task, onDismiss }: { task: TaskSummary; onDismiss?: () => void }) {
  const finished = task.ok + task.failed;
  const value = task.total ? Math.floor((finished / task.total) * 100) : 100;
  const state = task.status === "running" ? `${finished} / ${task.total}` : task.failed ? `${task.failed} 台没成功` : "全部成功";
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={task.name}>
          {task.name}
        </span>
        <span className={`shrink-0 text-xs ${task.status === "done" && task.failed ? "text-destructive" : "text-muted-foreground"}`}>{state}</span>
      </div>
      <Bar value={value} active={task.status === "running" || !task.failed} />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {task.projectName} · 成功 {task.ok}
          {task.failed ? ` · 失败 ${task.failed}` : ""} · {new Date(task.createdAt).toLocaleString("zh-CN")}
        </span>
        <Link href={`/projects/${task.projectId}`} className="shrink-0 underline-offset-4 hover:underline">
          查看
        </Link>
        {onDismiss ? (
          <button type="button" className="shrink-0 underline-offset-4 hover:underline" onClick={onDismiss}>
            关闭
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, float, onFloat, children }: { title: string; float: boolean; onFloat: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={float} onChange={(event) => onFloat(event.target.checked)} />
          小浮窗
        </label>
      </div>
      {children}
    </section>
  );
}

/** 右上角的任务列表：镜像上传和批量任务的进度都在这里，每类可以单独开小浮窗。 */
export function TaskCenter() {
  const pathname = usePathname();
  const uploads = useUploads();
  const [feed, setFeed] = useState<TaskFeed>(EMPTY);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<FloatPrefs>(DEFAULT_PREFS);
  // 小浮窗只跟这次打开页面以后跑过的批量任务，免得旧任务一上来就弹出来。
  const [followed, setFollowed] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const wrapper = useRef<HTMLDivElement>(null);

  const live = Object.values(uploads.live);
  const liveIds = new Set(live.map((item) => item.id));
  // 服务器上没传完、这个页面里也没有文件的，只能回镜像页重新选文件续传。
  const stale: LiveUpload[] = feed.uploads.filter((item) => !liveIds.has(item.id)).map((item) => ({ ...item, state: "paused" }));
  const panelUploads = [...live.filter((item) => item.state !== "done"), ...stale];
  const runningBatch = feed.tasks.filter((task) => task.status === "running");
  const busy = live.filter((item) => item.state === "running").length + runningBatch.length + feed.extracting.length;
  const doneCount = live.filter((item) => item.state === "done").length;

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (response.ok) setFeed(await response.json());
    } catch {
      // 断网时保留上次的列表，下一轮再取。
    }
  }, []);

  useEffect(() => setPrefs(loadPrefs()), []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, open || busy ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [load, open, busy]);

  // 上传刚传完时马上取一次，好接上“正在抽取”。
  useEffect(() => {
    if (doneCount) void load();
  }, [doneCount, load]);

  const runningIds = runningBatch.map((task) => task.id).join(",");
  useEffect(() => {
    if (!runningIds) return;
    setFollowed((current) => [...new Set([...current, ...runningIds.split(",")])]);
  }, [runningIds]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  function setFloat(kind: FloatKind, on: boolean) {
    const next = { ...prefs, [kind]: on };
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // 存不了就只在这次页面里生效。
    }
  }

  const floatUploads = prefs.upload && !pathname.startsWith("/images") ? live : [];
  const floatBatch = prefs.batch
    ? feed.tasks.filter((task) => followed.includes(task.id) && !dismissed.includes(task.id) && pathname !== `/projects/${task.projectId}`)
    : [];

  return (
    <>
      <div ref={wrapper} className="relative">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <ListChecks />
          任务
          {busy ? <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">{busy}</span> : null}
        </Button>
        {open ? (
          <div className="absolute top-full right-0 z-50 mt-2 grid max-h-[75vh] w-[min(24rem,calc(100vw-2rem))] gap-5 overflow-y-auto rounded-xl bg-card p-4 text-sm shadow-lg ring-1 ring-foreground/10">
            <Section title="镜像上传" float={prefs.upload} onFloat={(on) => setFloat("upload", on)}>
              {panelUploads.map((item) => (
                <UploadItem key={item.id} item={item} />
              ))}
              {feed.extracting.map((image) => (
                <div key={image.id} className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{image.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">识别和抽取中</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                  </div>
                </div>
              ))}
              {!panelUploads.length && !feed.extracting.length ? <p className="text-xs text-muted-foreground">没有进行中的上传。</p> : null}
            </Section>
            <Section title="批量任务" float={prefs.batch} onFloat={(on) => setFloat("batch", on)}>
              {feed.tasks.map((task) => (
                <BatchItem key={task.id} task={task} />
              ))}
              {!feed.tasks.length ? <p className="text-xs text-muted-foreground">还没有执行过批量任务。</p> : null}
            </Section>
          </div>
        ) : null}
      </div>
      <TaskFloat
        uploads={floatUploads}
        batch={floatBatch}
        onHide={setFloat}
        onDismissBatch={(id) => setDismissed((current) => [...current, id])}
      />
    </>
  );
}

/** 能拖动的小浮窗，只显示在任务列表里勾了“小浮窗”的那几类。 */
function TaskFloat({
  uploads,
  batch,
  onHide,
  onDismissBatch,
}: {
  uploads: LiveUpload[];
  batch: TaskSummary[];
  onHide: (kind: FloatKind, on: boolean) => void;
  onDismissBatch: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const visible = uploads.length > 0 || batch.length > 0;

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

  const heading = (title: string, kind: FloatKind, link?: { href: string; label: string }) => (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-xs font-medium text-muted-foreground">{title}</span>
      {link ? (
        <Link href={link.href} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          {link.label}
        </Link>
      ) : null}
      <button type="button" title="关掉这类的小浮窗，可以在右上角任务列表里重新打开" className="text-muted-foreground hover:text-foreground" onClick={() => onHide(kind, false)}>
        <X className="size-3.5" />
      </button>
    </div>
  );

  return (
    <div
      ref={box}
      className="fixed z-50 grid max-h-[70vh] w-72 gap-3 overflow-y-auto rounded-xl bg-card p-3 text-sm shadow-lg ring-1 ring-foreground/10"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }}
    >
      <div
        className="-m-3 mb-0 flex cursor-move touch-none items-center rounded-t-xl bg-muted/60 px-3 py-1.5 text-xs font-medium select-none"
        onPointerDown={(event) => {
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
        任务
      </div>
      {uploads.length ? (
        <div className="grid gap-2">
          {heading("镜像上传", "upload", { href: "/images", label: "打开镜像页" })}
          {uploads.map((item) => (
            <UploadItem key={item.id} item={item} />
          ))}
        </div>
      ) : null}
      {batch.length ? (
        <div className="grid gap-2">
          {heading("批量任务", "batch")}
          {batch.map((task) => (
            <BatchItem key={task.id} task={task} onDismiss={task.status === "done" ? () => onDismissBatch(task.id) : undefined} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
