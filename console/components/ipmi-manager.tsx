"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { IpmiSetting, Project } from "@/lib/types";

const EMPTY = {
  sn: "",
  projectId: "",
  mode: "static" as "static" | "dhcp",
  address: "",
  netmask: "255.255.255.0",
  gateway: "",
  channel: "1",
  vlanId: "",
  note: "",
};

export function IpmiManager({ settings, projects }: { settings: IpmiSetting[]; projects: Project[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function startCreate() {
    setEditing(null);
    setForm(EMPTY);
    setError("");
    setOpen(true);
  }

  function startEdit(setting: IpmiSetting) {
    setEditing(setting.id);
    setForm({
      sn: setting.sn,
      projectId: setting.projectId || "",
      mode: setting.mode,
      address: setting.address || "",
      netmask: setting.netmask,
      gateway: setting.gateway,
      channel: String(setting.channel),
      vlanId: setting.vlanId ? String(setting.vlanId) : "",
      note: setting.note,
    });
    setError("");
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(editing ? `/api/ipmi/${editing}` : "/api/ipmi", {
      method: editing ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sn: form.sn,
        projectId: form.projectId,
        mode: form.mode,
        address: form.address,
        netmask: form.netmask,
        gateway: form.gateway,
        channel: Number(form.channel),
        vlanId: form.vlanId ? Number(form.vlanId) : null,
        note: form.note,
      }),
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
    const response = await fetch(`/api/ipmi/${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <Button className="w-fit" onClick={startCreate}>
        添加序列号
      </Button>
      {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}
      {settings.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有 IPMI 记录。装完系统后，机器会读自己的序列号，只有对上的记录才会写入 BMC 网络。</p>
      ) : (
        <div className="grid gap-3">
          {settings.map((setting) => (
            <article key={setting.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-mono text-sm">{setting.sn}</h2>
                <span className="text-sm">{setting.mode === "static" ? setting.address : "DHCP"}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {projects.find((project) => project.id === setting.projectId)?.name || "未归项目"}
                {setting.mode === "static" ? ` · 网关 ${setting.gateway} · 掩码 ${setting.netmask}` : ""}
                {` · 通道 ${setting.channel}`}
                {setting.vlanId ? ` · VLAN ${setting.vlanId}` : ""}
                {setting.note ? ` · ${setting.note}` : ""}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => startEdit(setting)}>
                  编辑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(setting.id)}>
                  删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={save} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>{editing ? "编辑 IPMI 网络" : "按序列号设置 IPMI"}</DialogTitle>
              <DialogDescription>序列号与主板 DMI 里的 product_serial 对齐，空格会被去掉并转成大写。安装结束时用带内 ipmitool 写入，不改本地硬盘上的业务分区。</DialogDescription>
            </DialogHeader>
            <Field label="序列号">
              <Input value={form.sn} onChange={(event) => setForm({ ...form, sn: event.target.value })} required />
            </Field>
            <Field label="项目">
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={form.projectId}
                onChange={(event) => setForm({ ...form, projectId: event.target.value })}
              >
                <option value="">不归入项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="地址方式">
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={form.mode}
                onChange={(event) => setForm({ ...form, mode: event.target.value as "static" | "dhcp" })}
              >
                <option value="static">固定地址</option>
                <option value="dhcp">DHCP</option>
              </select>
            </Field>
            {form.mode === "static" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="IPMI 地址">
                  <Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} required />
                </Field>
                <Field label="掩码">
                  <Input value={form.netmask} onChange={(event) => setForm({ ...form, netmask: event.target.value })} required />
                </Field>
                <Field label="网关">
                  <Input value={form.gateway} onChange={(event) => setForm({ ...form, gateway: event.target.value })} required />
                </Field>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="IPMI 通道">
                <Input value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })} required />
              </Field>
              <Field label="VLAN，可留空">
                <Input value={form.vlanId} onChange={(event) => setForm({ ...form, vlanId: event.target.value })} />
              </Field>
            </div>
            <Field label="备注">
              <Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </Field>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "保存中" : "保存"}
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
