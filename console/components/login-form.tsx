"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

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
    <Paper component="form" onSubmit={submit} sx={{ borderRadius: "20px", p: { xs: 3, sm: 4 }, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.06)" }}>
      {/* 登录方式：Apple 的分段控件。 */}
      <ToggleButtonGroup exclusive fullWidth value={method} onChange={(_, value: Method | null) => value && choose(value)} aria-label="登录方式" sx={{ mb: 3 }}>
        {TABS.map((tab) => (
          <ToggleButton key={tab.id} value={tab.id}>
            {tab.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Stack spacing={2.5}>
        {method !== "key" ? (
          <TextField
            label="用户名"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setChallenge(null);
            }}
            autoComplete="username"
            autoFocus
            required
            fullWidth
            size="medium"
          />
        ) : null}

        {method === "password" ? (
          <TextField label="密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required fullWidth size="medium" />
        ) : null}

        {method === "key" ? (
          <TextField
            label="访问密钥"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="pxe_..."
            autoComplete="off"
            autoFocus
            required
            fullWidth
            size="medium"
            helperText="在「我的账号」里生成，或找管理员要。"
          />
        ) : null}

        {method === "ssh" && challenge ? (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                在自己电脑上执行，5 分钟内有效
              </Typography>
              <Box
                component="pre"
                sx={{ m: 0, p: 1.5, borderRadius: 2, bgcolor: "action.hover", fontFamily: '"SF Mono", ui-monospace, var(--font-geist-mono), monospace', fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "all" }}
              >
                {challenge.command}
              </Box>
              <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "text.secondary" }}>
                私钥不是 ~/.ssh/id_ed25519 时改 -f 后面的路径。用 ssh-agent 时 -f 指向对应的 .pub 文件。
              </Typography>
            </Box>
            <TextField
              label="把输出的整段签名贴到这里"
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              placeholder={"-----BEGIN SSH SIGNATURE-----\n...\n-----END SSH SIGNATURE-----"}
              multiline
              minRows={6}
              required
              fullWidth
              slotProps={{ htmlInput: { style: { fontFamily: '"SF Mono", ui-monospace, var(--font-geist-mono), monospace', fontSize: 12 } } }}
            />
          </Stack>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}
        <Button type="submit" variant="contained" size="large" disabled={pending} fullWidth>
          {pending ? "请稍候" : method === "ssh" && !challenge ? "获取挑战码" : "登录"}
        </Button>
      </Stack>
    </Paper>
  );
}
