"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DISK_LABEL, DISK_MODE_LABEL, FAMILY_LABEL, type DiskMode, type DiskPartition, type DiskPick, type DiskPolicy, type ImageRecord, type PartitionFs } from "@/lib/types";

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
  diskMode?: DiskMode;
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
  diskMode: "deploy" as DiskMode,
  packages: "openssh-server,curl",
  postScript: "",
  locale: "zh_CN.UTF-8",
  timezone: "Asia/Shanghai",
};

const LOCALES: [string, string][] = [
  ["zh_CN.UTF-8", "简体中文"],
  ["zh_TW.UTF-8", "繁體中文（台湾）"],
  ["zh_HK.UTF-8", "繁體中文（香港）"],
  ["en_US.UTF-8", "English (US)"],
  ["en_GB.UTF-8", "English (UK)"],
  ["ja_JP.UTF-8", "日本語"],
  ["ko_KR.UTF-8", "한국어"],
  ["de_DE.UTF-8", "Deutsch"],
  ["fr_FR.UTF-8", "Français"],
  ["es_ES.UTF-8", "Español"],
  ["pt_BR.UTF-8", "Português (Brasil)"],
  ["ru_RU.UTF-8", "Русский"],
  ["it_IT.UTF-8", "Italiano"],
  ["vi_VN.UTF-8", "Tiếng Việt"],
  ["th_TH.UTF-8", "ไทย"],
  ["id_ID.UTF-8", "Bahasa Indonesia"],
  ["ar_SA.UTF-8", "العربية"],
  ["C.UTF-8", "C（不本地化）"],
];

const TIMEZONES: [string, string][] = [
  ["Asia/Shanghai", "北京 / 上海 UTC+8"],
  ["Asia/Hong_Kong", "香港 UTC+8"],
  ["Asia/Taipei", "台北 UTC+8"],
  ["Asia/Singapore", "新加坡 UTC+8"],
  ["Asia/Tokyo", "东京 UTC+9"],
  ["Asia/Seoul", "首尔 UTC+9"],
  ["Asia/Bangkok", "曼谷 UTC+7"],
  ["Asia/Ho_Chi_Minh", "胡志明市 UTC+7"],
  ["Asia/Jakarta", "雅加达 UTC+7"],
  ["Asia/Kolkata", "印度 UTC+5:30"],
  ["Asia/Dubai", "迪拜 UTC+4"],
  ["Europe/Moscow", "莫斯科 UTC+3"],
  ["Europe/Berlin", "柏林 / 中欧"],
  ["Europe/Paris", "巴黎"],
  ["Europe/London", "伦敦"],
  ["America/New_York", "纽约 / 美东"],
  ["America/Chicago", "芝加哥 / 美中"],
  ["America/Denver", "丹佛 / 美山地"],
  ["America/Los_Angeles", "洛杉矶 / 美西"],
  ["America/Sao_Paulo", "圣保罗"],
  ["Australia/Sydney", "悉尼"],
  ["UTC", "UTC"],
];

// Keeps a value saved before these lists existed selectable instead of silently replacing it.
function withCurrent(options: [string, string][], current: string): [string, string][] {
  return !current || options.some(([value]) => value === current) ? options : [[current, "当前值"], ...options];
}

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
  const [pending, setPending] = useState(false);
  const diskImage = images.find((image) => image.id === form.imageId)?.kind === "disk";
  const live = diskImage && form.diskMode === "live";

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
      diskMode: profile.diskMode || "deploy",
      packages: profile.packages.join(","),
      postScript: profile.postScript,
      locale: profile.locale,
      timezone: profile.timezone,
    });
    setError("");
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
            const runsLive = image?.kind === "disk" && profile.diskMode === "live";
            return (
              <article key={profile.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium">{profile.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {image ? `${FAMILY_LABEL[image.family]} · ${image.name}` : "镜像已删除"} · 主机名 {profile.hostnamePattern}
                      {image?.kind === "disk" ? ` · ${DISK_MODE_LABEL[profile.diskMode || "deploy"]}` : ""}
                      {runsLive ? "" : ` · ${DISK_LABEL[profile.diskPolicy]}`}
                      {profile.diskPolicy === "named" && !runsLive ? ` ${profile.diskName}` : ""}
                      {profile.diskPolicy === "custom" ? ` · ${(profile.partitions || []).map((part) => `${part.mount} ${part.size === "rest" ? "剩余" : `${part.size}MB`}`).join("，")}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline">{runsLive ? "不碰硬盘" : "将清空所选磁盘"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(profile)}>
                    编辑
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
          <form onSubmit={save} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>{editing ? "编辑安装配置" : "新建安装配置"}</DialogTitle>
              <DialogDescription>
                {diskImage
                  ? "整盘镜像：绑定这条配置的机器按“启动方式”启动。落盘部署按磁盘策略选盘，整块盘清空后写入镜像，根分区扩到整块盘；内存运行把系统整个放进内存，不碰硬盘，每次从网卡启动都重新进内存系统。启动菜单里两种方式都能手动选。"
                  : "安装会按磁盘策略清空目标盘。"}
              </DialogDescription>
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
                    {image.kind === "disk" ? " · 整盘镜像" : ""}
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
            {diskImage ? (
              <Field label="启动方式">
                <select
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={form.diskMode}
                  onChange={(event) => setForm({ ...form, diskMode: event.target.value as DiskMode })}
                >
                  <option value="deploy">落盘部署（清空所选磁盘，写入镜像）</option>
                  <option value="live">内存运行（不碰硬盘，内存需大于根分区）</option>
                </select>
              </Field>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={live ? "磁盘策略（菜单里手动选落盘时用）" : "磁盘策略"}>
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
                  {diskImage ? null : <option value="custom">自定义分区</option>}
                </select>
              </Field>
              <Field label="盘符">
                <Input value={form.diskName} disabled={form.diskPolicy !== "named" && !(form.diskPolicy === "custom" && form.diskPick === "named")} onChange={(event) => setForm({ ...form, diskName: event.target.value })} />
              </Field>
            </div>
            {form.diskPolicy === "custom" && !diskImage ? (
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
            {diskImage ? null : (
              <>
                <Field label="软件包，用逗号分隔">
                  <Input value={form.packages} onChange={(event) => setForm({ ...form, packages: event.target.value })} />
                </Field>
                <Field label="语言">
                  <select
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                    value={form.locale}
                    onChange={(event) => setForm({ ...form, locale: event.target.value })}
                  >
                    {withCurrent(LOCALES, form.locale).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label} · {value}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="时区">
                  <select
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                    value={form.timezone}
                    onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                  >
                    {withCurrent(TIMEZONES, form.timezone).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label} · {value}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <Field label="安装后脚本">
              <Textarea
                value={form.postScript}
                onChange={(event) => setForm({ ...form, postScript: event.target.value })}
                rows={4}
                placeholder={diskImage ? "可选。写盘后在新系统里以 root 执行（chroot），内存运行时不执行。" : "可选。在装好的系统里以 root 执行。"}
              />
            </Field>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "保存中" : "保存配置"}
            </Button>
          </form>
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
