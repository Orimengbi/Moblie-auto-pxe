"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { CredentialManager } from "@/components/credential-manager";
import { PasswordForm } from "@/components/password-form";
import type { PublicUser } from "@/lib/auth";
import { api } from "@/lib/client-api";

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
    const result = await api(url, method, body);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    router.refresh();
    return result.data;
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const created = await send("/api/users", "POST", { username, password: password || undefined, role });
    if (!created) return;
    setOpen(false);
    setUsername("");
    setPassword("");
    setRole("user");
    setExpanded(String(created.id));
  }

  function remove(user: PublicUser) {
    if (!window.confirm(`删除用户 ${user.username}？`)) return;
    send(`/api/users/${user.id}`, "DELETE");
  }

  const errorText = error ? (
    <Typography variant="body2" color="error">
      {error}
    </Typography>
  ) : null;

  return (
    <Stack spacing={2}>
      <Box>
        <Button variant="contained" onClick={() => setOpen(true)}>
          新建用户
        </Button>
      </Box>
      {errorText}
      <Stack spacing={1.5}>
        {users.map((user) => (
          <Paper key={user.id} component="article" variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                  {user.username}
                </Typography>
                <Chip label={user.role === "admin" ? "管理员" : "普通用户"} color={user.role === "admin" ? "primary" : "default"} variant={user.role === "admin" ? "filled" : "outlined"} />
                {user.disabled ? <StatusChip tone="error" label="已停用" /> : null}
                {user.id === selfId ? (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    （你）
                  </Typography>
                ) : null}
              </Stack>
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={() => setExpanded(expanded === user.id ? "" : user.id)}>
                  {expanded === user.id ? "收起" : "密码和密钥"}
                </Button>
                <Button disabled={pending} onClick={() => send(`/api/users/${user.id}`, "PATCH", { role: user.role === "admin" ? "user" : "admin" })}>
                  {user.role === "admin" ? "改为普通用户" : "设为管理员"}
                </Button>
                {user.id !== selfId ? (
                  <>
                    <Button disabled={pending} onClick={() => send(`/api/users/${user.id}`, "PATCH", { disabled: !user.disabled })}>
                      {user.disabled ? "启用" : "停用"}
                    </Button>
                    <Button color="error" disabled={pending} onClick={() => remove(user)}>
                      删除
                    </Button>
                  </>
                ) : null}
              </Stack>
            </Stack>
            <Typography variant="body2" sx={{ mt: 1, color: "text.secondary" }}>
              {user.hasPassword ? "有密码" : "没有密码"} · SSH 公钥 {user.sshKeys.length} 把 · 访问密钥 {user.accessKeys.length} 把
            </Typography>
            {expanded === user.id ? (
              <Stack spacing={4} sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}>
                <Stack component="section" spacing={1.5}>
                  <Typography variant="h3">{user.id === selfId ? "修改密码" : "重设密码"}</Typography>
                  <PasswordForm userId={user.id} askCurrent={user.id === selfId && user.hasPassword} />
                  {user.hasPassword && user.id !== selfId ? (
                    <Box>
                      <Button
                        color="error"
                        disabled={pending}
                        onClick={() => window.confirm(`清除 ${user.username} 的密码？之后只能用密钥登录。`) && send(`/api/users/${user.id}`, "PATCH", { password: null })}
                      >
                        清除密码，只允许密钥登录
                      </Button>
                    </Box>
                  ) : null}
                </Stack>
                <CredentialManager user={user} />
              </Stack>
            ) : null}
          </Paper>
        ))}
      </Stack>
      <Dialog open={open} onClose={() => setOpen(false)} slotProps={{ paper: { component: "form", onSubmit: create } }}>
        <DialogTitle>新建用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText variant="body2">密码可以不填，建好后再给他添加 SSH 公钥或生成访问密钥。</DialogContentText>
            <TextField label="用户名" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="小写字母、数字、. _ -" required fullWidth />
            <TextField label="密码（至少 8 位，可不填）" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" fullWidth />
            <TextField select slotProps={{ select: { native: true } }} label="角色" value={role} onChange={(event) => setRole(event.target.value as "user" | "admin")} fullWidth>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </TextField>
            {errorText}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="submit" variant="contained" disabled={pending}>
            {pending ? "创建中" : "创建"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
