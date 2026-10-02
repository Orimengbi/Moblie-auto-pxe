"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FAMILY_LABEL, type ImageRecord } from "@/lib/types";

export function ImageManager({ images, incoming }: { images: ImageRecord[]; incoming: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [filename, setFilename] = useState(incoming[0] || "");
  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ offset: number; size: number } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const extracting = images.some((image) => image.status === "extracting");

  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [extracting, router]);

  useEffect(() => {
    if (!filename && incoming[0]) setFilename(incoming[0]);
  }, [filename, incoming]);

  async function importIncoming() {
    setPending(true);
    setError("");
    const response = await fetch("/api/images", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename, name }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "导入失败");
      return;
    }
    setName("");
    router.refresh();
  }

  async function uploadSelected() {
    if (!file) return;
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
    setPending(true);
    setError("");
    setProgress({ offset: 0, size: file.size });
    try {
      const opened = await fetch("/api/images/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, name: uploadName, fingerprint }),
      });
      const session = await opened.json();
      if (!opened.ok) throw new Error(session.error || "无法开始上传");
      localStorage.setItem(`pxe-iso:${fingerprint}`, session.id);
      let offset = Number(session.offset) || 0;
      const chunkSize = 4 * 1024 * 1024;
      while (offset < file.size) {
        const end = Math.min(offset + chunkSize, file.size);
        const response = await fetch(`/api/images/uploads/${session.id}`, {
          method: "PATCH",
          headers: { "upload-offset": String(offset), "content-type": "application/octet-stream" },
          body: file.slice(offset, end),
        });
        const body = await response.json();
        if (response.status === 409 && Number.isInteger(body.offset)) {
          offset = body.offset;
          setProgress({ offset, size: file.size });
          continue;
        }
        if (!response.ok) throw new Error(body.error || "上传中断");
        offset = body.offset;
        setProgress({ offset, size: file.size });
        if (body.image) {
          localStorage.removeItem(`pxe-iso:${fingerprint}`);
          setFile(null);
          setUploadName("");
          setProgress(null);
          router.refresh();
          return;
        }
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? `${uploadError.message}。重新选择同一个 ISO 会从上次的位置继续。` : "上传中断。重新选择同一个 ISO 会从上次的位置继续。");
    } finally {
      setPending(false);
    }
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
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">从 incoming 导入</h2>
          <p className="mt-1 text-sm text-muted-foreground">把 ISO 放到小主机的 data/incoming。大文件用这个方式，不经过浏览器。</p>
          {incoming.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">incoming 里还没有 ISO。</p>
          ) : (
            <div className="mt-4 grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="iso-file">ISO 文件</Label>
                <select
                  id="iso-file"
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                >
                  {incoming.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="iso-name">显示名称</Label>
                <Input id="iso-name" value={name} placeholder="可留空，默认用文件名" onChange={(event) => setName(event.target.value)} />
              </div>
              <Button type="button" disabled={pending || !filename} onClick={importIncoming}>
                {pending ? "处理中" : "开始识别并抽取"}
              </Button>
            </div>
          )}
        </section>
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">上传 ISO</h2>
          <p className="mt-1 text-sm text-muted-foreground">按 4MB 一段上传。中断后重新选择同一个文件，会从上次传到的位置继续，然后自动识别抽取。</p>
          <div className="mt-4 grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="upload-name">显示名称</Label>
              <Input id="upload-name" value={uploadName} placeholder="可留空" onChange={(event) => setUploadName(event.target.value)} />
            </div>
            <Input
              type="file"
              accept=".iso"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setProgress(null);
              }}
            />
            {progress ? (
              <p className="text-sm text-muted-foreground">
                已上传 {formatBytes(progress.offset)} / {formatBytes(progress.size)}（{progress.size ? Math.floor((progress.offset / progress.size) * 100) : 0}%）
              </p>
            ) : null}
            <Button type="button" variant="secondary" disabled={pending || !file} onClick={uploadSelected}>
              {pending ? "上传中" : progress && progress.offset > 0 ? "继续上传" : "上传并抽取"}
            </Button>
          </div>
        </section>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有镜像。导入 Ubuntu、Debian、Rocky Linux 或 AlmaLinux 的 x86_64 安装 ISO 后，这里会出现内核和应答入口。</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>家族</TableHead>
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
                  <TableCell>{image.status === "ready" ? `${FAMILY_LABEL[image.family]} ${image.version}` : image.status === "error" ? "未识别" : "识别中"}</TableCell>
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
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
