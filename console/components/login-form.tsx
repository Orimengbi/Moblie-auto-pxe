"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";

type Method = "password" | "key" | "ssh";

const TABS: { id: Method; label: string }[] = [
  { id: "password", label: "密码" },
  { id: "key", label: "访问密钥" },
  { id: "ssh", label: "SSH 公钥" },
];

export function LoginForm({ next }: { next: string }) {
  const [method, setMethod] = useState<Method>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [challenge, setChallenge] = useState<{ challenge: string; command: string } | null>(null);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function post(url: string, body: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, body: await response.json() };
  }

  async function getChallenge() {
    setError("");
    setPending(true);
    const result = await post("/api/auth/challenge", { username });
    setPending(false);
    if (!result.ok) {
      setError(result.body.error || "获取挑战码失败");
      return;
    }
    setChallenge(result.body);
    setSignature("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (method === "ssh" && !challenge) {
      await getChallenge();
      return;
    }
    setError("");
    setPending(true);
    const body =
      method === "password"
        ? { method, username, password }
        : method === "key"
          ? { method, key }
          : { method, challenge: challenge?.challenge, signature };
    const result = await post("/api/auth/login", body);
    setPending(false);
    if (!result.ok) {
      setError(result.body.error || "登录失败");
      if (method === "ssh") setChallenge(null);
      return;
    }
    // 整页跳转，让布局按登录后的身份重新渲染。
    window.location.href = next;
  }

  function choose(id: Method) {
    setMethod(id);
    setError("");
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-foreground/10">
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={method === tab.id}
            onClick={() => choose(tab.id)}
            className={cn("flex-1 rounded-md px-3 py-1.5 text-sm", method === tab.id ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {method !== "key" ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">用户名</span>
          <Input
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setChallenge(null);
            }}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
      ) : null}

      {method === "password" ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">密码</span>
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>
      ) : null}

      {method === "key" ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">访问密钥</span>
          <Input value={key} onChange={(event) => setKey(event.target.value)} placeholder="pxe_..." autoComplete="off" autoFocus required />
          <span className="text-muted-foreground">在「我的账号」里生成，或找管理员要。</span>
        </label>
      ) : null}

      {method === "ssh" && challenge ? (
        <div className="grid gap-3 text-sm">
          <div className="grid gap-1.5">
            <span className="font-medium">在自己电脑上执行，5 分钟内有效</span>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all select-all">{challenge.command}</pre>
            <span className="text-muted-foreground">私钥不是 ~/.ssh/id_ed25519 时改 -f 后面的路径。用 ssh-agent 时 -f 指向对应的 .pub 文件。</span>
          </div>
          <label className="grid gap-1.5">
            <span className="font-medium">把输出的整段签名贴到这里</span>
            <Textarea
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              placeholder={"-----BEGIN SSH SIGNATURE-----\n...\n-----END SSH SIGNATURE-----"}
              className="min-h-32 font-mono text-xs"
              required
            />
          </label>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "请稍候" : method === "ssh" && !challenge ? "获取挑战码" : "登录"}
      </Button>
    </form>
  );
}
