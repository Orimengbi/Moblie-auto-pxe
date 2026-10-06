"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ISO_ACCEPT, ISO_FORMATS_LABEL } from "@/lib/iso-name";
import { FAMILY_LABEL, type ImageRecord } from "@/lib/types";

export interface PendingUpload {
  id: string;
  filename: string;
  name: string;
  size: number;
  offset: number;
  fingerprint: string;
  updatedAt: string;
}

const CHUNK = 4 * 1024 * 1024;
const RETRIES = 5;

function fingerprintOf(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function percent(offset: number, size: number): number {
  return size ? Math.floor((offset / size) * 100) : 0;
}

class Paused extends Error {}

function without(map: Record<string, string>, key: string): Record<string, string> {
  const next = { ...map };
  delete next[key];
  return next;
}

export function ImageManager({ images, uploads }: { images: ImageRecord[]; uploads: PendingUpload[] }) {
  const router = useRouter();
  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [active, setActive] = useState<PendingUpload | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  // 这一页里选过的文件。断了以后点继续不用重新选；刷新页面后才需要再选一次。
  const files = useRef(new Map<string, File>());
  const abort = useRef<AbortController | null>(null);
  const resumePicker = useRef<HTMLInputElement>(null);
  const [resumeTarget, setResumeTarget] = useState<PendingUpload | null>(null);
  const extracting = images.some((image) => image.status === "extracting");
  const resumable = file ? uploads.find((item) => item.fingerprint === fingerprintOf(file) && item.size === file.size) : undefined;
  const tasks = active && !uploads.some((item) => item.id === active.id) ? [active, ...uploads] : uploads;

  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [extracting, router]);

  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

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

  /** 打开（或接上）一个上传会话，然后一段一段传完。断开、暂停都会留在下面的任务列表里。 */
  async function run(selected: File, name: string) {
    const controller = new AbortController();
    abort.current = controller;
    setError("");
    let task: PendingUpload | null = null;
    try {
      const opened = await fetch("/api/images/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: selected.name, size: selected.size, name, fingerprint: fingerprintOf(selected) }),
      });
      const session = await opened.json();
      if (!opened.ok) throw new Error(session.error || "无法开始上传");
      task = session as PendingUpload;
      files.current.set(task.id, selected);
      setTaskErrors((current) => without(current, task!.id));
      let offset = Number(task.offset) || 0;
      setActive({ ...task, offset });
      while (offset < selected.size) {
        const sent = await sendChunk(task.id, selected, offset, controller.signal);
        offset = sent.offset;
        setActive({ ...task, offset, updatedAt: new Date().toISOString() });
        if (sent.done) break;
      }
      files.current.delete(task.id);
    } catch (uploadError) {
      if (!(uploadError instanceof Paused)) {
        const message = uploadError instanceof Error ? uploadError.message : "上传中断";
        if (task) setTaskErrors((current) => ({ ...current, [task!.id]: message }));
        else setError(message);
      }
    } finally {
      abort.current = null;
      setActive(null);
      router.refresh();
    }
  }

  function startSelected() {
    if (!file) return;
    const selected = file;
    setFile(null);
    setUploadName("");
    setPickerKey((key) => key + 1);
    void run(selected, uploadName);
  }

  function resume(item: PendingUpload) {
    const known = files.current.get(item.id);
    if (known) {
      void run(known, item.name);
      return;
    }
    setResumeTarget(item);
    resumePicker.current?.click();
  }

  function resumeWith(picked: File | undefined) {
    const item = resumeTarget;
    setResumeTarget(null);
    if (!item || !picked) return;
    if (fingerprintOf(picked) !== item.fingerprint || picked.size !== item.size) {
      setTaskErrors((current) => ({ ...current, [item.id]: `选的不是原来的文件，请选 ${item.fingerprint.split(":")[0]}（${formatBytes(item.size)}）` }));
      return;
    }
    void run(picked, item.name);
  }

  async function cancel(item: PendingUpload) {
    if (!window.confirm(`取消上传 ${item.name || item.filename}？已经传上去的部分会删除。`)) return;
    if (active?.id === item.id) abort.current?.abort();
    const response = await fetch(`/api/images/uploads/${item.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 404) {
      setTaskErrors((current) => ({ ...current, [item.id]: body.error || "取消失败" }));
      return;
    }
    files.current.delete(item.id);
    setTaskErrors((current) => without(current, item.id));
    router.refresh();
  }

  async function remove(id: string) {
    setError("");
    const response = await fetch(`/api/images/${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">上传 ISO</h2>
        <p className="text-sm text-muted-foreground">
          支持 Ubuntu、Debian、Rocky Linux、AlmaLinux 的 x86_64 安装 ISO，也可以直接传压缩过的 ISO（{ISO_FORMATS_LABEL}），导入后自动解压。按 4MB 一段上传，网络抖动会自动重试；断开的上传会留在下面的任务里，可以继续或取消，传完自动识别抽取。
        </p>
        <div className="grid gap-3 sm:max-w-md">
          <div className="grid gap-1.5">
            <Label htmlFor="upload-name">显示名称</Label>
            <Input id="upload-name" value={uploadName} placeholder="可留空，默认用文件名" onChange={(event) => setUploadName(event.target.value)} />
          </div>
          <Input
            key={pickerKey}
            type="file"
            accept={ISO_ACCEPT}
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setError("");
            }}
          />
          {resumable ? (
            <p className="text-sm text-muted-foreground">
              这个文件上次传到 {formatBytes(resumable.offset)}（{percent(resumable.offset, resumable.size)}%），会从这里继续。
            </p>
          ) : null}
          <Button type="button" className="w-fit" disabled={Boolean(active) || !file} onClick={startSelected}>
            {resumable ? `从 ${percent(resumable.offset, resumable.size)}% 继续上传` : "上传并抽取"}
          </Button>
          {active ? <p className="text-sm text-muted-foreground">一次传一个。正在上传时不要关闭页面，下面可以暂停。</p> : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>

      <input
        ref={resumePicker}
        type="file"
        accept={ISO_ACCEPT}
        className="hidden"
        onChange={(event) => {
          resumeWith(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {tasks.length ? (
        <section className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">上传任务</h2>
          {tasks.map((item) => {
            const running = active?.id === item.id;
            const shown = running ? active : item;
            const taskError = taskErrors[item.id];
            return (
              <div key={item.id} className="grid gap-1.5 border-t pt-3 text-sm first-of-type:border-t-0 first-of-type:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.name || item.filename}</span>
                  {item.name ? <span className="text-xs text-muted-foreground">{item.filename}</span> : null}
                  <Badge variant={running ? "secondary" : taskError ? "destructive" : "outline"}>{running ? "上传中" : taskError ? "已中断" : "已暂停"}</Badge>
                  <div className="ml-auto flex gap-1">
                    {running ? (
                      <Button type="button" variant="secondary" size="sm" onClick={() => abort.current?.abort()}>
                        暂停
                      </Button>
                    ) : (
                      <Button type="button" variant="secondary" size="sm" disabled={Boolean(active)} onClick={() => resume(item)}>
                        继续
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={() => cancel(item)}>
                      取消
                    </Button>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full transition-all ${running ? "bg-primary" : "bg-muted-foreground/40"}`} style={{ width: `${percent(shown.offset, shown.size)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(shown.offset)} / {formatBytes(shown.size)}（{percent(shown.offset, shown.size)}%）
                  {running ? "" : ` · 最后更新 ${new Date(item.updatedAt).toLocaleString("zh-CN")}`}
                  {!running && !files.current.has(item.id) ? " · 继续时需要重新选择这个文件" : ""}
                </p>
                {taskError ? <p className="text-xs text-destructive">{taskError}</p> : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有镜像。上传安装 ISO 后会出现在这里。</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>镜像名称</TableHead>
                <TableHead>系统版本</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>状态</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {images.map((image) => (
                <TableRow key={image.id}>
                  <TableCell>
                    <div className="font-medium">{image.name}</div>
                    <div className="text-xs text-muted-foreground">{image.filename}</div>
                  </TableCell>
                  <TableCell>
                    {image.status === "ready" ? (
                      <>
                        <div>{FAMILY_LABEL[image.family]}</div>
                        <div className="max-w-sm text-xs whitespace-normal text-muted-foreground">{image.version}</div>
                      </>
                    ) : image.status === "error" ? (
                      "未识别"
                    ) : (
                      "识别中"
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{image.size ? formatBytes(image.size) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={image.status === "ready" ? "secondary" : image.status === "error" ? "destructive" : "outline"}>
                      {image.status === "ready" ? "可安装" : image.status === "error" ? "失败" : "抽取中"}
                    </Badge>
                    {image.error ? <p className="mt-1 max-w-sm text-xs text-destructive">{image.error}</p> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => remove(image.id)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}
