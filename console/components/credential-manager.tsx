"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PublicUser } from "@/lib/auth";
import { api } from "@/lib/client-api";

function day(iso?: string) {
  return iso ? iso.slice(0, 10) : "从未";
}

async function send(url: string, method: string, body?: unknown) {
  const result = await api(url, method, body);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** 一个用户的 SSH 公钥和访问密钥。我的账号页和用户管理页共用。 */
export function CredentialManager({ user }: { user: PublicUser }) {
  const router = useRouter();
  const [sshName, setSshName] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [created, setCreated] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const base = `/api/users/${user.id}`;

  async function run(fn: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  function addSsh(event: React.FormEvent) {
    event.preventDefault();
    run(async () => {
      await send(`${base}/ssh-keys`, "POST", { name: sshName, publicKey: sshKey });
      setSshName("");
      setSshKey("");
    });
  }

  function addAccessKey(event: React.FormEvent) {
    event.preventDefault();
    run(async () => {
      const result = await send(`${base}/access-keys`, "POST", { name: keyName });
      setKeyName("");
      setCreated(String(result.secret));
    });
  }

  function remove(kind: "ssh-keys" | "access-keys", id: string, label: string) {
    if (!window.confirm(`删除「${label}」？用它登录的会话会立即失效。`)) return;
    run(async () => {
      await send(`${base}/${kind}/${id}`, "DELETE");
    });
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h3 className="font-medium">SSH 公钥</h3>
        {user.sshKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有公钥。添加后可以在登录页用 ssh-keygen 签名登录。</p>
        ) : (
          <ul className="grid gap-2">
            {user.sshKeys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{key.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {key.publicKey.split(" ")[0]} {key.fingerprint} · 添加于 {day(key.createdAt)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove("ssh-keys", key.id, key.name)}>
                  删除
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addSsh} className="grid gap-2">
          <Textarea
            value={sshKey}
            onChange={(event) => setSshKey(event.target.value)}
            placeholder="ssh-ed25519 AAAA... user@host（~/.ssh/id_ed25519.pub 的内容）"
            className="min-h-20 font-mono text-xs"
            required
          />
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" value={sshName} onChange={(event) => setSshName(event.target.value)} placeholder="名称（可不填，默认用公钥注释）" />
            <Button type="submit" variant="secondary" disabled={pending}>
              添加公钥
            </Button>
          </div>
        </form>
      </section>

      <section className="grid gap-3">
        <h3 className="font-medium">访问密钥</h3>
        <p className="text-sm text-muted-foreground">
          可以在登录页直接粘贴登录，也可以给脚本用：<code className="font-mono text-xs">curl -H &quot;Authorization: Bearer pxe_...&quot;</code>。权限和这个用户相同。
        </p>
        {user.accessKeys.length ? (
          <ul className="grid gap-2">
            {user.accessKeys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{key.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    pxe_{key.id}_… · 创建于 {day(key.createdAt)} · 最近使用 {day(key.lastUsedAt)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove("access-keys", key.id, key.name)}>
                  删除
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={addAccessKey} className="flex flex-wrap gap-2">
          <Input className="max-w-xs" value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="用途，例如 笔记本 / 巡检脚本" />
          <Button type="submit" variant="secondary" disabled={pending}>
            生成访问密钥
          </Button>
        </form>
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Dialog open={Boolean(created)} onOpenChange={(open) => !open && setCreated("")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新的访问密钥</DialogTitle>
            <DialogDescription>只显示这一次，关掉后无法再查看。丢了就删掉重新生成。</DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap select-all">{created}</pre>
          <Button onClick={() => navigator.clipboard?.writeText(created)}>复制</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
