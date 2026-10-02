"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { NicPlan } from "@/lib/types";

const EMPTY = {
  sn: "",
  label: "",
  mac: "",
  iface: "",
  address: "",
  netmask: "255.255.255.0",
  gateway: "",
  dns: "",
  hostname: "",
  note: "",
};

export function ProjectNicManager({ projectId, plans }: { projectId: string; plans: NicPlan[] }) {
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

  function startEdit(plan: NicPlan) {
    setEditing(plan.id);
    setForm({
      sn: plan.sn,
      label: plan.label || "",
      mac: plan.mac || "",
      iface: plan.iface || "",
      address: plan.address,
      netmask: plan.netmask,
      gateway: plan.gateway,
      dns: plan.dns,
      hostname: plan.hostname || "",
      note: plan.note,
    });
    setError("");
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.mac.trim() && !form.iface.trim()) {
      setError("填这块网卡的 MAC，或填接口名");
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch(editing ? `/api/nics/${editing}` : "/api/nics", {
      method: editing ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, projectId }),
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
    const response = await fetch(`/api/nics/${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        一台机器可以加多块网卡。每一条都要写明是哪一块：填这块网卡的 MAC，或填系统里的接口名。装完后只改你点名的网卡。
      </p>
      <Button className="w-fit" onClick={startCreate}>
        添加网卡
      </Button>
      {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有网卡。同一序列号可以加多条，每条对应一块网卡。</p>
      ) : (
        <div className="grid gap-3">
          {plans.map((plan) => (
            <article key={plan.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-mono text-sm">{plan.sn}</h2>
                <span className="text-sm">{plan.address}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {plan.label ? `${plan.label} · ` : ""}
                {plan.mac ? `MAC ${plan.mac}` : `接口 ${plan.iface}`}
                {plan.mac && plan.iface ? ` · 接口 ${plan.iface}` : ""}
                {` · 掩码 ${plan.netmask}`}
                {plan.gateway ? ` · 网关 ${plan.gateway}` : " · 不设默认路由"}
                {plan.dns ? ` · DNS ${plan.dns}` : ""}
                {plan.note ? ` · ${plan.note}` : ""}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => startEdit(plan)}>
                  编辑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(plan.id)}>
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
              <DialogTitle>{editing ? "编辑这块网卡" : "指定一块网卡"}</DialogTitle>
              <DialogDescription>
                MAC 和接口名至少填一个。两边都填时，安装结束按 MAC 找到这块网卡。网关留空表示这块网卡不设默认路由。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="序列号">
                <Input value={form.sn} onChange={(event) => setForm({ ...form, sn: event.target.value })} required />
              </Field>
              <Field label="称呼，可留空">
                <Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="业务口" />
              </Field>
              <Field label="网卡 MAC">
                <Input value={form.mac} onChange={(event) => setForm({ ...form, mac: event.target.value })} placeholder="aa:bb:cc:dd:ee:ff" />
              </Field>
              <Field label="接口名">
                <Input value={form.iface} onChange={(event) => setForm({ ...form, iface: event.target.value })} placeholder="ens1f0" />
              </Field>
              <Field label="IP">
                <Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} required />
              </Field>
              <Field label="掩码">
                <Input value={form.netmask} onChange={(event) => setForm({ ...form, netmask: event.target.value })} required />
              </Field>
              <Field label="网关，可留空">
                <Input value={form.gateway} onChange={(event) => setForm({ ...form, gateway: event.target.value })} />
              </Field>
              <Field label="DNS，可留空">
                <Input value={form.dns} onChange={(event) => setForm({ ...form, dns: event.target.value })} placeholder="多个用逗号分开" />
              </Field>
            </div>
            <Field label="主机名，可留空">
              <Input value={form.hostname} onChange={(event) => setForm({ ...form, hostname: event.target.value })} />
            </Field>
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
