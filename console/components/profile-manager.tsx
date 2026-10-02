"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DISK_LABEL, FAMILY_LABEL, type DiskPartition, type DiskPick, type DiskPolicy, type ImageRecord, type PartitionFs } from "@/lib/types";

interface PublicProfile {
  id: string;
  name: string;
  imageId: string;
  hostnamePattern: string;
  username: string;
  diskPolicy: DiskPolicy;
  diskName: string;
  diskPick?: DiskPick;
  partitions?: DiskPartition[];
  packages: string[];
  postScript: string;
  locale: string;
  timezone: string;
}

const EMPTY = {
  name: "",
  imageId: "",
  hostnamePattern: "srv-{{mac_last4}}",
  username: "ops",
  password: "",
  diskPolicy: "largest" as DiskPolicy,
  diskName: "sda",
  diskPick: "largest" as DiskPick,
  partitions: [] as DiskPartition[],
  packages: "openssh-server,curl",
  postScript: "",
  locale: "zh_CN.UTF-8",
  timezone: "Asia/Shanghai",
};

export function ProfileManager({
  projectId,
  profiles,
  images,
}: {
  projectId: string;
  profiles: PublicProfile[];
  images: ImageRecord[];
}) {
  const router = useRouter();
  const ready = images.filter((image) => image.status === "ready");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [pending, setPending] = useState(false);

  function updatePartition(index: number, patch: Partial<DiskPartition>) {
    setForm({
      ...form,
      partitions: form.partitions.map((part, item) => (item === index ? { ...part, ...patch } : part)),
    });
  }

  function startCreate() {
    setEditing(null);
    setForm({ ...EMPTY, imageId: ready[0]?.id || "" });
    setError("");
    setPreview("");
    setOpen(true);
  }

  function startEdit(profile: PublicProfile) {
    setEditing(profile.id);
    setForm({
      name: profile.name,
      imageId: profile.imageId,
      hostnamePattern: profile.hostnamePattern,
      username: profile.username,
      password: "",
      diskPolicy: profile.diskPolicy,
      diskName: profile.diskName,
      diskPick: profile.diskPick || "largest",
      partitions: profile.partitions || [],
      packages: profile.packages.join(","),
      postScript: profile.postScript,
      locale: profile.locale,
      timezone: profile.timezone,
    });
    setError("");
    setPreview("");
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const payload = {
      ...form,
      projectId,
      packages: form.packages.split(/[,\s]+/).filter(Boolean),
      password: form.password || undefined,
    };
    const response = await fetch(editing ? `/api/profiles/${editing}` : "/api/profiles", {
      method: editing ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "保存失败");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
    router.refresh();
  }

  async function showPreview(id: string) {
    const response = await fetch(`/api/profiles/${id}/preview`);
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "无法预览");
      return;
    }
    setPreview(body.files.map((file: { filename: string; body: string }) => `# ${file.filename}\n${file.body}`).join("\n"));
    setOpen(true);
    setEditing(null);
  }

  return (
    <div className="grid gap-4">
      <div>
        <Button onClick={startCreate} disabled={ready.length === 0}>
          新建安装配置
        </Button>
        {ready.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">先导入并抽好一个镜像，才能写无人值守配置。</p> : null}
      </div>
      {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}
      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有安装配置。配置里写明主机名、账号和要清空的磁盘，菜单里选中后全程不再询问。</p>
      ) : (
        <div className="grid gap-3">
          {profiles.map((profile) => {
            const image = images.find((item) => item.id === profile.imageId);
            return (
              <article key={profile.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium">{profile.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {image ? `${FAMILY_LABEL[image.family]} · ${image.name}` : "镜像已删除"} · 主机名 {profile.hostnamePattern} · {DISK_LABEL[profile.diskPolicy]}
                      {profile.diskPolicy === "named" ? ` ${profile.diskName}` : ""}
                      {profile.diskPolicy === "custom" ? ` · ${(profile.partitions || []).map((part) => `${part.mount} ${part.size === "rest" ? "剩余" : `${part.size}MB`}`).join("，")}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline">将清空所选磁盘</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(profile)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => showPreview(profile.id)}>
                    预览应答
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(profile.id)}>
                    删除
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {preview && !editing && !form.name ? (
            <>
              <DialogHeader>
                <DialogTitle>应答文件预览</DialogTitle>
                <DialogDescription>示例 MAC 为 00:11:22:33:44:55。真实启动时会换成目标机器的 MAC。</DialogDescription>
              </DialogHeader>
              <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{preview}</pre>
            </>
          ) : (
            <form onSubmit={save} className="grid gap-3">
              <DialogHeader>
                <DialogTitle>{editing ? "编辑安装配置" : "新建安装配置"}</DialogTitle>
                <DialogDescription>安装会按磁盘策略清空目标盘。</DialogDescription>
              </DialogHeader>
              <Field label="名称">
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
              </Field>
              <Field label="镜像">
                <select
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={form.imageId}
                  onChange={(event) => setForm({ ...form, imageId: event.target.value })}
                >
                  {ready.map((image) => (
                    <option key={image.id} value={image.id}>
                      {image.name} · {FAMILY_LABEL[image.family]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="主机名">
                <Input value={form.hostnamePattern} onChange={(event) => setForm({ ...form, hostnamePattern: event.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="用户名">
                  <Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
                </Field>
                <Field label={editing ? "新密码（留空则不变）" : "密码"}>
                  <Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required={!editing} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="磁盘策略">
                  <select
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                    value={form.diskPolicy}
                    onChange={(event) => {
                      const diskPolicy = event.target.value as DiskPolicy;
                      const partitions = diskPolicy === "custom" && form.partitions.length === 0
                        ? [
                            { mount: "/boot/efi", size: "512", fs: "fat32" as const },
                            { mount: "/boot", size: "1024", fs: "ext4" as const },
                            { mount: "/", size: "rest", fs: "ext4" as const },
                          ]
                        : form.partitions;
                      setForm({ ...form, diskPolicy, partitions });
                    }}
                  >
                    <option value="largest">最大的磁盘</option>
                    <option value="smallest">最小的磁盘</option>
                    <option value="named">指定盘符</option>
                    <option value="custom">自定义分区</option>
                  </select>
                </Field>
                <Field label="盘符">
                  <Input value={form.diskName} disabled={form.diskPolicy !== "named" && !(form.diskPolicy === "custom" && form.diskPick === "named")} onChange={(event) => setForm({ ...form, diskName: event.target.value })} />
                </Field>
              </div>
              {form.diskPolicy === "custom" ? (
                <div className="grid gap-3">
                  <Field label="用哪块盘">
                    <select
                      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                      value={form.diskPick}
                      onChange={(event) => setForm({ ...form, diskPick: event.target.value as DiskPick })}
                    >
                      <option value="largest">最大的磁盘</option>
                      <option value="smallest">最小的磁盘</option>
                      <option value="named">指定盘符</option>
                    </select>
                  </Field>
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">分区</span>
                    <p className="text-sm text-muted-foreground">大小填 MB。其中一个填 rest，表示用完这块盘的剩余空间。需要 EFI 时加上 /boot/efi。</p>
                    {form.partitions.map((part, index) => (
                      <div key={index} className="grid grid-cols-[1.2fr_0.8fr_0.8fr_auto] gap-2">
                        <Input value={part.mount} placeholder="/" onChange={(event) => updatePartition(index, { mount: event.target.value })} />
                        <Input value={part.size} placeholder="rest" onChange={(event) => updatePartition(index, { size: event.target.value })} />
                        <select
                          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                          value={part.fs}
                          onChange={(event) => updatePartition(index, { fs: event.target.value as PartitionFs })}
                        >
                          <option value="ext4">ext4</option>
                          <option value="xfs">xfs</option>
                          <option value="fat32">fat32</option>
                          <option value="swap">swap</option>
                        </select>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, partitions: form.partitions.filter((_, item) => item !== index) })}>
                          删除
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-fit"
                      onClick={() => setForm({ ...form, partitions: [...form.partitions, { mount: "/", size: "rest", fs: "ext4" }] })}
                    >
                      添加分区
                    </Button>
                  </div>
                </div>
              ) : null}
              <Field label="软件包，用逗号分隔">
                <Input value={form.packages} onChange={(event) => setForm({ ...form, packages: event.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="区域">
                  <Input value={form.locale} onChange={(event) => setForm({ ...form, locale: event.target.value })} />
                </Field>
                <Field label="时区">
                  <Input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
                </Field>
              </div>
              <Field label="安装后脚本">
                <Textarea value={form.postScript} onChange={(event) => setForm({ ...form, postScript: event.target.value })} rows={4} placeholder="可选。在装好的系统里以 root 执行。" />
              </Field>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={pending}>
                {pending ? "保存中" : "保存配置"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
