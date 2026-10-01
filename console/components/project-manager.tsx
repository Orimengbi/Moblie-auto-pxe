"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Project } from "@/lib/types";

export function ProjectManager({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, note }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "创建失败");
      return;
    }
    setOpen(false);
    setName("");
    setNote("");
    router.push(`/projects/${body.id}`);
    router.refresh();
  }

  async function toggle(project: Project) {
    setError("");
    const response = await fetch(`/api/projects/${project.id}/enable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !project.enabled }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "无法切换项目");
      return;
    }
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
      <Button className="w-fit" onClick={() => setOpen(true)}>
        新建项目
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有项目。新建后只是一个空目录，再到里面填写安装设置、DHCP 和 IPMI。</p>
      ) : (
        <div className="grid gap-3">
          {projects.map((project) => (
            <article key={project.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-medium">{project.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{project.note || "还没有备注"}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={project.enabled}
                  onClick={() => toggle(project)}
                  className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm ${project.enabled ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                >
                  <span className={`inline-block size-3 rounded-full ${project.enabled ? "bg-primary-foreground" : "bg-foreground/40"}`} />
                  {project.enabled ? "已启用" : "未启用"}
                </button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {project.dhcp ? `DHCP ${project.dhcp.start} – ${project.dhcp.end}` : "还没写 DHCP"}
                {project.enabled ? " · 当前装机使用这套配置" : ""}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" render={<Link href={`/projects/${project.id}`} />}>
                  进入项目
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(project.id)}>
                  删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={create} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
              <DialogDescription>先建立项目目录。安装设置、DHCP 和 IPMI 进去之后再填。同一时间只能启用一个项目。</DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">名称</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">备注</span>
              <Input value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "创建中" : "创建"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
