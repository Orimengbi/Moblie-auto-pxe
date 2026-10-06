"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** 改自己的密码；管理员给别人重设时不需要当前密码。 */
export function PasswordForm({ userId, askCurrent }: { userId: string; askCurrent: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password !== confirm) {
      setError("两次输入的密码不一样");
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, currentPassword: current }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error || "修改失败");
      return;
    }
    setCurrent("");
    setPassword("");
    setConfirm("");
    setMessage("密码已更新，其他地方的登录已退出。");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid max-w-sm gap-3">
      {askCurrent ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">当前密码</span>
          <Input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
        </label>
      ) : null}
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">新密码</span>
        <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">再输一次</span>
        <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? "保存中" : "修改密码"}
      </Button>
    </form>
  );
}
