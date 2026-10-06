"use client";

import { useEffect, useState } from "react";
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

export function ImageManager({ images, uploads }: { images: ImageRecord[]; uploads: PendingUpload[] }) {
  const router = useRouter();
  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ offset: number; size: number } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const extracting = images.some((image) => image.status === "extracting");
  const resumable = file ? uploads.find((item) => item.fingerprint === fingerprintOf(file) && item.size === file.size) : undefined;

  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [extracting, router]);

  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  /** 发一段。网络断开或控制台 5xx 时等一会再试；服务器说位置不对时按它的位置继续。 */
  async function sendChunk(id: string, selected: File, offset: number): Promise<{ offset: number; done: boolean }> {
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      let response: Response;
      try {
        response = await fetch(`/api/images/uploads/${id}`, {
          method: "PATCH",
          headers: { "upload-offset": String(offset), "content-type": "application/octet-stream" },
          body: selected.slice(offset, Math.min(offset + CHUNK, selected.size)),
        });
      } catch {
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

  async function uploadSelected() {
    if (!file) return;
    const selected = file;
    setPending(true);
    setError("");
    setProgress({ offset: resumable?.offset || 0, size: selected.size });
    try {
      const opened = await fetch("/api/images/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: selected.name, size: selected.size, name: uploadName, fingerprint: fingerprintOf(selected) }),
      });
      const session = await opened.json();
      if (!opened.ok) throw new Error(session.error || "无法开始上传");
      let offset = Number(session.offset) || 0;
      setProgress({ offset, size: selected.size });
      while (offset < selected.size) {
        const sent = await sendChunk(session.id, selected, offset);
        offset = sent.offset;
        setProgress({ offset, size: selected.size });
        if (sent.done) break;
      }
      setFile(null);
      setUploadName("");
      setProgress(null);
      router.refresh();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "上传中断";
      setError(`${message}。已经传上去的部分会保留，重新选择同一个 ISO 会从断开的位置继续。`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function discard(id: string) {
    if (!window.confirm("放弃这个没传完的 ISO？已经传上去的部分会删除。")) return;
    const response = await fetch(`/api/images/uploads/${id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
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
          支持 Ubuntu、Debian、Rocky Linux、AlmaLinux 的 x86_64 安装 ISO，也可以直接传压缩过的 ISO（{ISO_FORMATS_LABEL}），导入后自动解压。按 4MB 一段上传，网络抖动会自动重试；断开后重新选择同一个文件，会从断开的位置接着传，传完自动识别抽取。
        </p>
        <div className="grid gap-3 sm:max-w-md">
          <div className="grid gap-1.5">
            <Label htmlFor="upload-name">显示名称</Label>
            <Input id="upload-name" value={uploadName} placeholder="可留空，默认用文件名" onChange={(event) => setUploadName(event.target.value)} />
          </div>
          <Input
            type="file"
            accept={ISO_ACCEPT}
            disabled={pending}
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setProgress(null);
              setError("");
            }}
          />
          {resumable && !pending ? (
            <p className="text-sm text-muted-foreground">
              这个文件上次传到 {formatBytes(resumable.offset)}（{percent(resumable.offset, resumable.size)}%），会从这里继续。
            </p>
          ) : null}
          {progress ? (
            <div className="grid gap-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${percent(progress.offset, progress.size)}%` }} />
              </div>
              <p className="text-sm text-muted-foreground">
                已上传 {formatBytes(progress.offset)} / {formatBytes(progress.size)}（{percent(progress.offset, progress.size)}%）
              </p>
            </div>
          ) : null}
          <Button type="button" className="w-fit" disabled={pending || !file} onClick={uploadSelected}>
            {pending ? "上传中，不要关闭页面" : resumable ? `从 ${percent(resumable.offset, resumable.size)}% 继续上传` : "上传并抽取"}
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>

      {uploads.length ? (
        <section className="grid gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">没传完的上传</h2>
          <p className="text-sm text-muted-foreground">在上面重新选择同一个文件就会接着传。</p>
          {uploads.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{item.name || item.filename}</span>
              <span className="text-muted-foreground">
                {formatBytes(item.offset)} / {formatBytes(item.size)}（{percent(item.offset, item.size)}%）
              </span>
              <span className="text-xs text-muted-foreground">最后更新 {new Date(item.updatedAt).toLocaleString("zh-CN")}</span>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => discard(item.id)}>
                放弃
              </Button>
            </div>
          ))}
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
