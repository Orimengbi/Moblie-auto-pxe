"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BuiltinDiag, DiagScript } from "@/lib/types";

const CHECKS: { key: keyof BuiltinDiag; label: string; detail: string }[] = [
  { key: "cpu", label: "CPU", detail: "型号、核数和频率" },
  { key: "memory", label: "内存", detail: "容量、DMI，以及 64MB 抽样内存测试" },
  { key: "nic", label: "网卡", detail: "链路和地址" },
  { key: "thermal", label: "温度", detail: "有传感器时读取" },
  { key: "disk", label: "磁盘", detail: "只读身份和 SMART 健康，不挂载" },
  { key: "firmware", label: "固件", detail: "厂家、型号和序列号" },
];

export function DiagManager({
  ready,
  builtin,
  scripts,
}: {
  ready: boolean;
  builtin: BuiltinDiag;
  scripts: DiagScript[];
}) {
  const router = useRouter();
  const [flags, setFlags] = useState(builtin);
  const [name, setName] = useState("");
  const [body, setBody] = useState("#!/bin/sh\necho 验机脚本开始\n");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);

  async function saveFlags() {
    setPending(true);
    setError("");
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ builtinDiag: flags }),
    });
    const payload = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(payload.error || "保存失败");
      return;
    }
    setSaved("内置项目已更新。下一次验机会按新的开关执行。");
    router.refresh();
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, body }),
    });
    const payload = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(payload.error || "上传失败");
      return;
    }
    setName("");
    setBody("#!/bin/sh\n");
    router.refresh();
  }

  async function toggle(script: DiagScript) {
    const response = await fetch(`/api/scripts/${script.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !script.enabled }),
    });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error || "更新失败");
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/scripts/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error || "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">验机镜像</h2>
          <Badge variant={ready ? "default" : "outline"}>{ready ? "已就位" : "未构建"}</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          在小主机上执行 <code className="font-mono">sudo ./diag/build-image.sh</code>。脚本会下载固定的 Alpine 网络启动内核，并把验机代理、只读检查工具打进 apkovl。目标机把系统放进内存，init 不挂载本地硬盘。
        </p>
      </section>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">内置只读检查</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {CHECKS.map((check) => (
            <label key={check.key} className="flex gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={flags[check.key]}
                onChange={(event) => setFlags({ ...flags, [check.key]: event.target.checked })}
              />
              <span>
                <span className="font-medium">{check.label}</span>
                <span className="mt-0.5 block text-muted-foreground">{check.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <Button className="mt-4" onClick={saveFlags} disabled={pending}>
          保存检查项
        </Button>
        {saved ? <p className="mt-2 text-sm text-muted-foreground">{saved}</p> : null}
      </section>
      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <form onSubmit={upload} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="font-medium">上传自定义脚本</h2>
          <p className="text-sm text-muted-foreground">脚本以 root 运行。运行器会拒绝挂载或写入本地磁盘的命令，结束后再检查挂载表。</p>
          <div className="grid gap-1.5">
            <Label htmlFor="script-name">名称</Label>
            <Input id="script-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={8} className="font-mono text-xs" />
          <Button type="submit" disabled={pending}>
            保存脚本
          </Button>
        </form>
        <div className="grid gap-3">
          {scripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有自定义脚本。内置检查仍然可以单独运行。</p>
          ) : (
            scripts.map((script) => (
              <article key={script.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{script.name}</h3>
                  <Badge variant={script.enabled ? "secondary" : "outline"}>{script.enabled ? "启用" : "停用"}</Badge>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => toggle(script)}>
                    {script.enabled ? "停用" : "启用"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(script.id)}>
                    删除
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
