"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project } from "@/lib/types";

export function ProjectDhcpForm({ project }: { project: Project }) {
  const router = useRouter();
  const [form, setForm] = useState({
    dhcpStart: project.dhcp?.start || "",
    dhcpEnd: project.dhcp?.end || "",
    dhcpNetmask: project.dhcp?.netmask || "255.255.255.0",
    dhcpGateway: project.dhcp?.gateway || "",
    dhcpDns: project.dhcp?.dns || "",
    leaseHours: String(project.dhcp?.leaseHours || 2),
    fixedMode: project.fixed?.mode || "static",
    fixedNetmask: project.fixed?.netmask || "255.255.255.0",
    fixedGateway: project.fixed?.gateway || "",
    fixedDns: project.fixed?.dns || "",
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSaved("");
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dhcp: {
          start: form.dhcpStart,
          end: form.dhcpEnd,
          netmask: form.dhcpNetmask,
          gateway: form.dhcpGateway,
          dns: form.dhcpDns,
          leaseHours: Number(form.leaseHours),
        },
        fixed: {
          mode: form.fixedMode,
          netmask: form.fixedNetmask,
          gateway: form.fixedGateway,
          dns: form.fixedDns,
        },
      }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "保存失败");
      return;
    }
    setSaved("DHCP 已写入这个项目。打开项目开关后，装机才使用这套地址池。");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="font-medium">DHCP</h2>
      <p className="text-sm text-muted-foreground">装机时用这个临时地址池。地址池要和本机装机地址在同一个子网。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="起点" value={form.dhcpStart} onChange={(value) => setForm({ ...form, dhcpStart: value })} />
        <Field label="终点" value={form.dhcpEnd} onChange={(value) => setForm({ ...form, dhcpEnd: value })} />
        <Field label="掩码" value={form.dhcpNetmask} onChange={(value) => setForm({ ...form, dhcpNetmask: value })} />
        <Field label="网关" value={form.dhcpGateway} onChange={(value) => setForm({ ...form, dhcpGateway: value })} />
        <Field label="DNS" value={form.dhcpDns} onChange={(value) => setForm({ ...form, dhcpDns: value })} />
        <Field label="租约（小时）" value={form.leaseHours} onChange={(value) => setForm({ ...form, leaseHours: value })} />
      </div>
      <h3 className="pt-2 text-sm font-medium">装完后的网络</h3>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">方式</span>
        <select
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          value={form.fixedMode}
          onChange={(event) => setForm({ ...form, fixedMode: event.target.value as "static" | "dhcp" })}
        >
          <option value="static">每台机器一个固定 IP</option>
          <option value="dhcp">装完后仍用 DHCP</option>
        </select>
      </label>
      {form.fixedMode === "static" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="掩码" value={form.fixedNetmask} onChange={(value) => setForm({ ...form, fixedNetmask: value })} />
          <Field label="网关" value={form.fixedGateway} onChange={(value) => setForm({ ...form, fixedGateway: value })} />
          <Field label="DNS" value={form.fixedDns} onChange={(value) => setForm({ ...form, fixedDns: value })} />
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {saved ? <p className="text-sm text-muted-foreground">{saved}</p> : null}
      <Button className="w-fit" type="submit" disabled={pending}>
        {pending ? "保存中" : "保存 DHCP"}
      </Button>
    </form>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} required />
    </label>
  );
}
