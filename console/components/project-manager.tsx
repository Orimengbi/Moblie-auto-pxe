"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Machine, Project } from "@/lib/types";

const EMPTY = {
  name: "",
  note: "",
  dhcpStart: "192.168.77.10",
  dhcpEnd: "192.168.77.40",
  dhcpNetmask: "255.255.255.0",
  dhcpGateway: "192.168.77.1",
  dhcpDns: "192.168.77.1",
  leaseHours: "2",
  fixedMode: "static" as "static" | "dhcp",
  fixedNetmask: "255.255.255.0",
  fixedGateway: "10.0.0.1",
  fixedDns: "10.0.0.1",
};

export function ProjectManager({ projects, machines }: { projects: Project[]; machines: Machine[] }) {
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

  function startEdit(project: Project) {
    setEditing(project.id);
    setForm({
      name: project.name,
      note: project.note,
      dhcpStart: project.dhcp.start,
      dhcpEnd: project.dhcp.end,
      dhcpNetmask: project.dhcp.netmask,
      dhcpGateway: project.dhcp.gateway,
      dhcpDns: project.dhcp.dns,
      leaseHours: String(project.dhcp.leaseHours),
      fixedMode: project.fixed.mode,
      fixedNetmask: project.fixed.netmask,
      fixedGateway: project.fixed.gateway,
      fixedDns: project.fixed.dns,
    });
    setError("");
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const payload = {
      name: form.name,
      note: form.note,
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
    };
    const response = await fetch(editing ? `/api/projects/${editing}` : "/api/projects", {
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
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
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
        新建项目
      </Button>
      {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有项目。一个项目是一批机器：装机时共用一个临时地址池，装完后可以写入各自的固定地址。</p>
      ) : (
        <div className="grid gap-3">
          {projects.map((project) => {
            const members = machines.filter((machine) => machine.projectId === project.id);
            const missing = project.fixed.mode === "static" ? members.filter((machine) => !machine.fixedIp).length : 0;
            return (
              <article key={project.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <h2 className="font-medium">{project.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{project.note || "无备注"}</p>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">装机临时地址</dt>
                    <dd>
                      {project.dhcp.start} – {project.dhcp.end}，租约 {project.dhcp.leaseHours} 小时
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">装完后的网络</dt>
                    <dd>
                      {project.fixed.mode === "static"
                        ? `固定地址，网关 ${project.fixed.gateway}，掩码 ${project.fixed.netmask}`
                        : "继续使用 DHCP"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-sm text-muted-foreground">
                  {members.length} 台机器
                  {missing ? `，其中 ${missing} 台还没有固定 IP` : ""}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(project)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(project.id)}>
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
              <DialogTitle>{editing ? "编辑项目" : "新建项目"}</DialogTitle>
              <DialogDescription>临时地址只在装机网里使用。固定网络写进装好的系统，下次启动才生效，不会打断正在进行的安装。</DialogDescription>
            </DialogHeader>
            <Field label="项目名称">
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </Field>
            <Field label="备注">
              <Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </Field>
            <h3 className="pt-2 text-sm font-medium">装机临时地址池</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="起点">
                <Input value={form.dhcpStart} onChange={(event) => setForm({ ...form, dhcpStart: event.target.value })} required />
              </Field>
              <Field label="终点">
                <Input value={form.dhcpEnd} onChange={(event) => setForm({ ...form, dhcpEnd: event.target.value })} required />
              </Field>
              <Field label="掩码">
                <Input value={form.dhcpNetmask} onChange={(event) => setForm({ ...form, dhcpNetmask: event.target.value })} required />
              </Field>
              <Field label="网关">
                <Input value={form.dhcpGateway} onChange={(event) => setForm({ ...form, dhcpGateway: event.target.value })} required />
              </Field>
              <Field label="DNS">
                <Input value={form.dhcpDns} onChange={(event) => setForm({ ...form, dhcpDns: event.target.value })} required />
              </Field>
              <Field label="租约（小时）">
                <Input value={form.leaseHours} onChange={(event) => setForm({ ...form, leaseHours: event.target.value })} required />
              </Field>
            </div>
            <h3 className="pt-2 text-sm font-medium">装完后的网络</h3>
            <Field label="方式">
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={form.fixedMode}
                onChange={(event) => setForm({ ...form, fixedMode: event.target.value as "static" | "dhcp" })}
              >
                <option value="static">每台机器一个固定 IP</option>
                <option value="dhcp">装完后仍用 DHCP</option>
              </select>
            </Field>
            {form.fixedMode === "static" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="掩码">
                  <Input value={form.fixedNetmask} onChange={(event) => setForm({ ...form, fixedNetmask: event.target.value })} />
                </Field>
                <Field label="网关">
                  <Input value={form.fixedGateway} onChange={(event) => setForm({ ...form, fixedGateway: event.target.value })} />
                </Field>
                <Field label="DNS，多个用逗号">
                  <Input value={form.fixedDns} onChange={(event) => setForm({ ...form, fixedDns: event.target.value })} />
                </Field>
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "保存中" : "保存项目"}
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
