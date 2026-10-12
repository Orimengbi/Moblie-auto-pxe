"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/lib/client-api";
import { BUILTIN_ROLES, PERMISSION_GROUPS, PERMISSIONS, type Permission, type RoleDef } from "@/lib/roles";

type Editing = { id: string; name: string; description: string; permissions: Permission[]; builtin: boolean };

/**
 * 角色：一组权限点。内置四个（管理员固定全部权限，其余可以改权限点、恢复默认），也可以自己建。
 * own 是当前登录的人自己的权限点：只能勾自己有的。counts 是每个角色有几个账号在用。
 */
export function RoleAdmin({ roles, own, counts }: { roles: RoleDef[]; own: Permission[]; counts: Record<string, number> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const mine = new Set(own);

  async function send(url: string, method: string, body?: unknown) {
    setPending(true);
    setError("");
    const result = await api(url, method, body);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function save() {
    if (!editing) return;
    const body = { name: editing.name, description: editing.description, permissions: editing.permissions };
    if (await send(editing.id ? `/api/roles/${editing.id}` : "/api/roles", editing.id ? "PATCH" : "POST", body)) setEditing(null);
  }

  function toggle(permission: Permission, on: boolean) {
    if (!editing) return;
    setEditing({ ...editing, permissions: on ? [...editing.permissions, permission] : editing.permissions.filter((item) => item !== permission) });
  }

  const changed = (role: RoleDef) => {
    const factory = BUILTIN_ROLES.find((item) => item.id === role.id);
    return Boolean(factory && role.id !== "admin" && [...factory.permissions].sort().join() !== [...role.permissions].sort().join());
  };

  return (
    <Stack spacing={1.5}>
      <Box>
        <Button variant="outlined" onClick={() => setEditing({ id: "", name: "", description: "", permissions: [], builtin: false })}>
          新建角色
        </Button>
      </Box>
      {error && !editing ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {roles.map((role) => (
        <Paper key={role.id} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              {role.name}
            </Typography>
            {role.builtin ? <Chip size="small" variant="outlined" label={changed(role) ? "内置 · 改过" : "内置"} /> : null}
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {counts[role.id] || 0} 个账号
            </Typography>
            <Box sx={{ flex: 1 }} />
            {role.id !== "admin" ? (
              <Button size="small" disabled={pending} onClick={() => setEditing({ ...role })}>
                编辑
              </Button>
            ) : null}
            {changed(role) ? (
              <Button size="small" disabled={pending} onClick={() => window.confirm(`把「${role.name}」的权限点恢复成默认？`) && send(`/api/roles/${role.id}`, "PATCH", { reset: true })}>
                恢复默认
              </Button>
            ) : null}
            {!role.builtin ? (
              <Button size="small" color="error" disabled={pending} onClick={() => window.confirm(`删除角色「${role.name}」？`) && send(`/api/roles/${role.id}`, "DELETE")}>
                删除
              </Button>
            ) : null}
          </Stack>
          {role.description ? (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
              {role.description}
            </Typography>
          ) : null}
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {role.id === "admin"
              ? "全部权限"
              : role.permissions.length
                ? PERMISSIONS.filter((item) => role.permissions.includes(item.key))
                    .map((item) => item.label)
                    .join("、")
                : "只能看，不能改任何东西"}
          </Typography>
        </Paper>
      ))}
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="md">
        <DialogTitle>{editing?.id ? `编辑角色「${editing.name}」` : "新建角色"}</DialogTitle>
        <DialogContent>
          {editing ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {!editing.builtin ? (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField label="角色名" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required sx={{ minWidth: 200 }} />
                  <TextField label="说明（可不填）" value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} fullWidth />
                </Stack>
              ) : null}
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                看所有页面、导出表格、下载单台日志不用勾，谁都能做。灰掉的是你自己没有的权限，不能给别人。改完以后，用这个角色的人马上按新权限算。
              </Typography>
              {PERMISSION_GROUPS.map((group) => (
                <Box key={group}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {group}
                  </Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, columnGap: 2 }}>
                    {PERMISSIONS.filter((item) => item.group === group).map((item) => (
                      <FormControlLabel
                        key={item.key}
                        disabled={!mine.has(item.key)}
                        control={<Checkbox size="small" checked={editing.permissions.includes(item.key)} onChange={(event) => toggle(item.key, event.target.checked)} />}
                        label={
                          <Typography variant="body2">
                            {item.label}
                            {item.hint ? (
                              <Box component="span" sx={{ color: "text.secondary" }}>
                                {" "}
                                · {item.hint}
                              </Box>
                            ) : null}
                          </Typography>
                        }
                      />
                    ))}
                  </Box>
                </Box>
              ))}
              {error ? (
                <Typography variant="body2" color="error">
                  {error}
                </Typography>
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>取消</Button>
          <Button variant="contained" disabled={pending || (editing ? !editing.builtin && !editing.name.trim() : true)} onClick={() => void save()}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
