"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DiagScript, Machine, MachineAction } from "@/lib/types";

interface ProfileOption {
  id: string;
  name: string;
}

const ACTION_LABEL: Record<MachineAction, string> = {
  menu: "只显示菜单",
  install: "超时后安装",
  diag: "超时后验机",
};

export function MachineManager({
  machines,
  profiles,
  scripts,
}: {
  machines: Machine[];
  profiles: ProfileOption[];
  scripts: DiagScript[];
}) {
  const router = useRouter();
  const [mac, setMac] = useState("");
  const [action, setAction] = useState<MachineAction>("menu");
  const [profileId, setProfileId] = useState(profiles[0]?.id || "");
  const [scriptIds, setScriptIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function load(machine: Machine) {
    setMac(machine.mac);
    setAction(machine.action);
    setProfileId(machine.profileId || profiles[0]?.id || "");
    setScriptIds(machine.scriptIds);
    setNote(machine.note);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/machines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mac, action, profileId, scriptIds, note }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "保存失败");
      return;
    }
    setMac("");
    setNote("");
    setScriptIds([]);
    router.refresh();
  }

  async function remove(target: string) {
    const response = await fetch(`/api/machines/${encodeURIComponent(target)}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error || "删除失败");
      return;
    }
    router.refresh();
  }

  function toggleScript(id: string) {
    setScriptIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <form onSubmit={save} className="grid h-fit gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="grid gap-1.5">
          <Label htmlFor="mac">MAC 地址</Label>
          <Input id="mac" value={mac} onChange={(event) => setMac(event.target.value)} placeholder="aa:bb:cc:dd:ee:ff" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="action">启动后</Label>
          <select
            id="action"
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={action}
            onChange={(event) => setAction(event.target.value as MachineAction)}
          >
            <option value="menu">只显示菜单，超时进本地硬盘</option>
            <option value="install">超时后按配置安装</option>
            <option value="diag">超时后进入验机</option>
          </select>
        </div>
        {action === "install" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="profile">安装配置</Label>
            <select
              id="profile"
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">验机脚本</legend>
          <p className="text-xs text-muted-foreground">不勾选时，验机会跑全部已启用脚本。</p>
          {scripts.length === 0 ? <p className="text-xs text-muted-foreground">还没有上传脚本。</p> : null}
          {scripts.map((script) => (
            <label key={script.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scriptIds.includes(script.id)} onChange={() => toggleScript(script.id)} />
              {script.name}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="note">备注</Label>
          <Input id="note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={pending || (action === "install" && profiles.length === 0)}>
          {pending ? "保存中" : "保存绑定"}
        </Button>
      </form>
      <div className="grid gap-3">
        {machines.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有机器记录。目标服务器一旦从这台小主机启动，MAC 会出现在这里；也可以提前绑定。</p>
        ) : (
          machines.map((machine) => (
            <article key={machine.mac} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-mono text-sm">{machine.mac}</h2>
                <span className="text-sm">{ACTION_LABEL[machine.action]}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {machine.note || "无备注"}
                {machine.lastSeen ? ` · 最近出现 ${machine.lastSeen.replace("T", " ").slice(0, 19)}` : ""}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => load(machine)}>
                  载入编辑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(machine.mac)}>
                  删除
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
