"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

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
    <Stack component="form" onSubmit={submit} spacing={2} sx={{ maxWidth: 384 }}>
      {askCurrent ? (
        <TextField label="当前密码" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required fullWidth />
      ) : null}
      <TextField
        label="新密码"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        slotProps={{ htmlInput: { minLength: 8 } }}
        required
        fullWidth
      />
      <TextField
        label="再输一次"
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        autoComplete="new-password"
        slotProps={{ htmlInput: { minLength: 8 } }}
        required
        fullWidth
      />
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {message ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {message}
        </Typography>
      ) : null}
      <Box>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? "保存中" : "修改密码"}
        </Button>
      </Box>
    </Stack>
  );
}
