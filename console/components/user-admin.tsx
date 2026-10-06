"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CredentialManager } from "@/components/credential-manager";
import { PasswordForm } from "@/components/password-form";
import type { PublicUser } from "@/lib/auth";

export function UserAdmin({ users, selfId }: { users: PublicUser[]; selfId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [expanded, setExpanded] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function send(url: string, method: string, body?: unknown) {
    setPending(true);
    setError("");
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(data.error || "操作失败");
      return null;
    }
    router.refresh();
    return data;
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const created = await send("/api/users", "POST", { username, password: password || undefined, role });
    if (!created) return;
    setOpen(false);
    setUsername("");
    setPassword("");
    setRole("user");
    setExpanded(created.id);
  }

  function remove(user: PublicUser) {
    if (!window.confirm(`删除用户 ${user.username}？`)) return;
    send(`/api/users/${user.id}`, "DELETE");
  }

  return (
    <div className="grid gap-4">
      <Button className="w-fit" onClick={() => setOpen(true)}>
        新建用户
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-3">
        {users.map((user) => (
          <article key={user.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{user.username}</h2>
                <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role === "admin" ? "管理员" : "普通用户"}</Badge>
                {user.disabled ? <Badge variant="destructive">已停用</Badge> : null}
                {user.id === selfId ? <span className="text-xs text-muted-foreground">（你）</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setExpanded(expanded === user.id ? "" : user.id)}>
                  {expanded === user.id ? "收起" : "密码和密钥"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => send(`/api/users/${user.id}`, "PATCH", { role: user.role === "admin" ? "user" : "admin" })}
                >
                  {user.role === "admin" ? "改为普通用户" : "设为管理员"}
                </Button>
                {user.id !== selfId ? (
                  <>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => send(`/api/users/${user.id}`, "PATCH", { disabled: !user.disabled })}>
                      {user.disabled ? "启用" : "停用"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(user)}>
                      删除
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {user.hasPassword ? "有密码" : "没有密码"} · SSH 公钥 {user.sshKeys.length} 把 · 访问密钥 {user.accessKeys.length} 把
            </p>
            {expanded === user.id ? (
              <div className="mt-4 grid gap-6 border-t pt-4">
                <section className="grid gap-3">
                  <h3 className="font-medium">{user.id === selfId ? "修改密码" : "重设密码"}</h3>
                  <PasswordForm userId={user.id} askCurrent={user.id === selfId && user.hasPassword} />
                  {user.hasPassword && user.id !== selfId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-fit"
                      disabled={pending}
                      onClick={() => window.confirm(`清除 ${user.username} 的密码？之后只能用密钥登录。`) && send(`/api/users/${user.id}`, "PATCH", { password: null })}
                    >
                      清除密码，只允许密钥登录
                    </Button>
                  ) : null}
                </section>
                <CredentialManager user={user} />
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={create} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>新建用户</DialogTitle>
              <DialogDescription>密码可以不填，建好后再给他添加 SSH 公钥或生成访问密钥。</DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">用户名</span>
              <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="小写字母、数字、. _ -" required />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">密码（至少 8 位，可不填）</span>
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">角色</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "user" | "admin")}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
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
