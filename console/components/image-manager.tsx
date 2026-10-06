"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes, fingerprintOf, percent, useUploads, type LiveUpload, type PendingUpload } from "@/components/upload-provider";
import { ISO_ACCEPT, ISO_FORMATS_LABEL } from "@/lib/iso-name";
import { FAMILY_LABEL, type ImageRecord } from "@/lib/types";

export type { PendingUpload } from "@/components/upload-provider";

function without(map: Record<string, string>, key: string): Record<string, string> {
  const next = { ...map };
  delete next[key];
  return next;
}

export function ImageManager({ images, uploads }: { images: ImageRecord[]; uploads: PendingUpload[] }) {
  const router = useRouter();
  const live = useUploads();
  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [pickErrors, setPickErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const resumePicker = useRef<HTMLInputElement>(null);
  const [resumeTarget, setResumeTarget] = useState<PendingUpload | null>(null);
  const extracting = images.some((image) => image.status === "extracting");
  const resumable = file ? uploads.find((item) => item.fingerprint === fingerprintOf(file) && item.size === file.size) : undefined;
  // 服务器记着的没传完的会话，叠上这个页面里正在跑或刚断开的状态。
  const tasks: LiveUpload[] = [
    ...Object.values(live.live).filter((item) => item.state !== "done" && !uploads.some((upload) => upload.id === item.id)),
    ...uploads.map((item) => {
      const current = live.live[item.id];
      return current ? { ...item, ...current, offset: Math.max(item.offset, current.offset) } : { ...item, state: "paused" as const };
    }),
  ];
  const doneIds = Object.values(live.live).filter((item) => item.state === "done").map((item) => item.id).join(",");

  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [extracting, router]);

  // 传完的已经在下面的镜像表里了，不用再挂着。
  useEffect(() => {
    if (doneIds) doneIds.split(",").forEach((id) => live.dismiss(id));
  }, [doneIds, live]);

  function startSelected() {
    if (!file) return;
    const selected = file;
    setFile(null);
    setUploadName("");
    setPickerKey((key) => key + 1);
    setError("");
    live.run(selected, uploadName);
  }

  function resume(item: PendingUpload) {
    setPickErrors((current) => without(current, item.id));
    if (live.resume(item.id)) return;
    setResumeTarget(item);
    resumePicker.current?.click();
  }

  function resumeWith(picked: File | undefined) {
    const item = resumeTarget;
    setResumeTarget(null);
    if (!item || !picked) return;
    if (fingerprintOf(picked) !== item.fingerprint || picked.size !== item.size) {
      setPickErrors((current) => ({ ...current, [item.id]: `选的不是原来的文件，请选 ${item.fingerprint.split(":")[0]}（${formatBytes(item.size)}）` }));
      return;
    }
    live.run(picked, item.name);
  }

  async function cancel(item: PendingUpload) {
    if (!window.confirm(`取消上传 ${item.name || item.filename}？已经传上去的部分会删除。`)) return;
    const failed = await live.cancel(item);
    if (failed) setPickErrors((current) => ({ ...current, [item.id]: failed }));
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
          <Button type="button" className="w-fit" disabled={live.running || !file} onClick={startSelected}>
            {resumable ? `从 ${percent(resumable.offset, resumable.size)}% 继续上传` : "上传并抽取"}
          </Button>
          {live.running ? <p className="text-sm text-muted-foreground">一次传一个。切到别的页面会继续传，进度在右下角的小窗里；只是不要刷新或关闭页面。</p> : null}
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
            const running = item.state === "running";
            const taskError = pickErrors[item.id] || item.error;
            return (
              <div key={item.id} className="grid gap-1.5 border-t pt-3 text-sm first-of-type:border-t-0 first-of-type:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.name || item.filename}</span>
                  {item.name ? <span className="text-xs text-muted-foreground">{item.filename}</span> : null}
                  <Badge variant={running ? "secondary" : item.state === "error" ? "destructive" : "outline"}>{running ? "上传中" : item.state === "error" ? "已中断" : "已暂停"}</Badge>
                  <div className="ml-auto flex gap-1">
                    {running ? (
                      <Button type="button" variant="secondary" size="sm" onClick={live.pause}>
                        暂停
                      </Button>
                    ) : item.id.startsWith("failed-") ? null : (
                      <Button type="button" variant="secondary" size="sm" disabled={live.running} onClick={() => resume(item)}>
                        继续
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={() => cancel(item)}>
                      {item.id.startsWith("failed-") ? "关闭" : "取消"}
                    </Button>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full transition-all ${running ? "bg-primary" : "bg-muted-foreground/40"}`} style={{ width: `${percent(item.offset, item.size)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(item.offset)} / {formatBytes(item.size)}（{percent(item.offset, item.size)}%）
                  {running ? "" : ` · 最后更新 ${new Date(item.updatedAt).toLocaleString("zh-CN")}`}
                  {!running && !live.hasFile(item.id) && !item.id.startsWith("failed-") ? " · 继续时需要重新选择这个文件" : ""}
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
