"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { api } from "@/lib/client-api";
import { IPMI_PRIVILEGE_LABEL, type BmcUserAction, type BmcUserChange, type IpmiPrivilege, type IpmiUser } from "@/lib/ipmi-user-types";
import { useCan } from "@/components/role-context";

const MONO = "var(--font-geist-mono), monospace";
const NATIVE_LABELED = { select: { native: true }, inputLabel: { shrink: true } } as const;
const PRIVILEGES: IpmiPrivilege[] = ["ADMINISTRATOR", "OPERATOR", "USER"];

type Editing = { action: BmcUserAction; user: IpmiUser | null } | null;

/** 生成一个 16 位随机密码（字母数字加几个符号，BMC 都认）。 */
export function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const symbols = "!@#%^*-_=+";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const out = Array.from(bytes, (byte, index) => (index === 5 || index === 11 ? symbols[byte % symbols.length] : chars[byte % chars.length]));
  return out.join("");
}

/** 填用户名、密码、权限的表单，单台和批量共用。 */
export function UserChangeFields({ action, value, onChange, nameLocked }: { action: BmcUserAction; value: BmcUserChange; onChange: (value: BmcUserChange) => void; nameLocked?: boolean }) {
  const needsPassword = action === "ensure" || action === "password";
  const needsPrivilege = action === "ensure" || action === "privilege";
  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <TextField label="用户名" value={value.name} disabled={nameLocked} onChange={(event) => onChange({ ...value, name: event.target.value })} slotProps={{ htmlInput: { maxLength: 16, style: { fontFamily: MONO } } }} />
      {needsPassword ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <TextField
            label="密码"
            value={value.password || ""}
            onChange={(event) => onChange({ ...value, password: event.target.value })}
            helperText="8 到 20 个字符，不能有空格和引号"
            slotProps={{ htmlInput: { maxLength: 20, style: { fontFamily: MONO } } }}
            sx={{ flex: 1 }}
          />
          <Button sx={{ mt: 1 }} onClick={() => onChange({ ...value, password: randomPassword() })}>
            随机生成
          </Button>
        </Stack>
      ) : null}
      {needsPrivilege ? (
        <TextField select label="权限" value={value.privilege || "ADMINISTRATOR"} onChange={(event) => onChange({ ...value, privilege: event.target.value as IpmiPrivilege })} slotProps={NATIVE_LABELED}>
          {PRIVILEGES.map((item) => (
            <option key={item} value={item}>
              {IPMI_PRIVILEGE_LABEL[item]}（{item}）
            </option>
          ))}
        </TextField>
      ) : null}
    </Stack>
  );
}

const TITLE: Record<BmcUserAction, string> = { ensure: "新建用户", password: "改密码", privilege: "改权限", enable: "启用", disable: "停用", delete: "删除用户" };

/** 侧边栏「BMC 用户」：这台 BMC 的 16 个 IPMI 用户槽，增删改。 */
export function ServerBmcUsers({ assetId }: { assetId: string }) {
  const [users, setUsers] = useState<IpmiUser[] | null>(null);
  const [loginUser, setLoginUser] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState<BmcUserChange>({ action: "ensure", name: "", password: "", privilege: "ADMINISTRATOR" });
  const [pending, setPending] = useState(false);
  const canManage = useCan("bmc.users");
  const [showEmpty, setShowEmpty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api<{ users: IpmiUser[]; loginUser: string }>(`/api/assets/${assetId}/bmc-users`);
    setLoading(false);
    if (!result.ok) return setError(result.error);
    setError("");
    setUsers(result.data.users);
    setLoginUser(result.data.loginUser);
  }, [assetId]);

  useEffect(() => {
    setUsers(null);
    setNotice("");
    void load();
  }, [load]);

  function open(action: BmcUserAction, user: IpmiUser | null) {
    setForm({ action, name: user?.name || "", password: action === "ensure" || action === "password" ? randomPassword() : undefined, privilege: user && user.privilege in IPMI_PRIVILEGE_LABEL && PRIVILEGES.includes(user.privilege as IpmiPrivilege) ? (user.privilege as IpmiPrivilege) : "ADMINISTRATOR" });
    setEditing({ action, user });
  }

  async function submit() {
    if (!editing) return;
    setPending(true);
    const result = await api<{ message: string; users: IpmiUser[]; loginUser: string }>(`/api/assets/${assetId}/bmc-users`, "POST", { ...form, action: editing.action });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setError("");
    setNotice(`${result.data.message}${form.password ? `。密码：${form.password}（只显示这一次，记下来）` : ""}`);
    setUsers(result.data.users);
    setLoginUser(result.data.loginUser);
    setEditing(null);
  }

  const named = (users || []).filter((user) => user.name);
  const empty = (users || []).filter((user) => !user.name);

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1, flexWrap: "wrap" }}>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="subtitle2">IPMI 用户</Typography>
            <Typography variant="body2" color="text.secondary">
              BMC 的 LAN 通道上一共 {users?.length || 16} 个用户槽，网页、Redfish 和 IPMI 共用这些账号。控制台用 <Box component="span" sx={{ fontFamily: MONO }}>{loginUser || "…"}</Box> 登录，这个账号不能停用、删除或降权限；改它的密码时资产里存的密码会一起改。
            </Typography>
          </Box>
          <Button size="small" disabled={loading} onClick={() => void load()}>
            刷新
          </Button>
          {canManage ? (
            <Button size="small" variant="contained" disabled={!users} onClick={() => open("ensure", null)}>
              新建用户
            </Button>
          ) : null}
        </Stack>
        {loading && !users ? <LinearProgress /> : null}
        {error ? (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert severity="success" sx={{ mb: 1, wordBreak: "break-all" }} onClose={() => setNotice("")}>
            {notice}
          </Alert>
        ) : null}
        {users ? (
          <Box>
            {named.map((user) => {
              const self = user.name.toLowerCase() === loginUser.toLowerCase();
              return (
                <Stack key={user.id} direction="row" useFlexGap spacing={1} sx={{ py: 1, borderBottom: 1, borderColor: "divider", alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="caption" sx={{ width: 28, color: "text.secondary" }}>
                    {user.id}
                  </Typography>
                  <Box sx={{ fontFamily: MONO, fontSize: 14, width: 130, overflowWrap: "anywhere" }}>
                    {user.name}
                    {self ? (
                      <Typography component="span" variant="caption" sx={{ display: "block", color: "text.secondary", fontFamily: "inherit" }}>
                        控制台在用
                      </Typography>
                    ) : null}
                  </Box>
                  <StatusChip tone={user.enabled ? "success" : "neutral"} outlined={!user.enabled} label={user.enabled ? "启用" : "停用"} />
                  <StatusChip tone={user.privilege === "ADMINISTRATOR" ? "primary" : "neutral"} label={IPMI_PRIVILEGE_LABEL[user.privilege]} />
                  {!user.ipmi ? <StatusChip tone="warning" label="IPMI 未开" /> : null}
                  <Stack direction="row" spacing={0.5} sx={{ ml: "auto", display: canManage ? undefined : "none" }}>
                    <Button size="small" onClick={() => open("password", user)}>
                      改密码
                    </Button>
                    <Button size="small" disabled={self} onClick={() => open("privilege", user)}>
                      改权限
                    </Button>
                    {user.enabled ? (
                      <Button size="small" disabled={self} onClick={() => open("disable", user)}>
                        停用
                      </Button>
                    ) : (
                      <Button size="small" onClick={() => open("enable", user)}>
                        启用
                      </Button>
                    )}
                    <Button size="small" color="error" disabled={self} onClick={() => open("delete", user)}>
                      删除
                    </Button>
                  </Stack>
                </Stack>
              );
            })}
            <Button size="small" sx={{ mt: 1 }} onClick={() => setShowEmpty(!showEmpty)}>
              {showEmpty ? "收起空槽" : `还有 ${empty.length} 个空槽`}
            </Button>
            {showEmpty ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontFamily: MONO }}>
                {empty.map((user) => `${user.id}${user.fixed ? "（匿名，固定）" : ""}`).join("、")}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Paper>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {editing ? TITLE[editing.action] : ""}
          {editing?.user ? ` · ${editing.user.name}` : ""}
        </DialogTitle>
        <DialogContent>
          {editing && (editing.action === "enable" || editing.action === "disable" || editing.action === "delete") ? (
            <DialogContentText>
              {editing.action === "delete"
                ? `删掉 ${editing.user?.name}：停用、收回权限并清空用户名，这个槽位空出来。用这个账号登 BMC 网页、Redfish、IPMI 的都会登不上。`
                : editing.action === "disable"
                  ? `停用 ${editing.user?.name}，之后用它登不上 BMC，账号和密码还留着，随时可以再启用。`
                  : `启用 ${editing.user?.name}。`}
            </DialogContentText>
          ) : editing ? (
            <UserChangeFields action={editing.action} value={form} nameLocked={Boolean(editing.user)} onChange={setForm} />
          ) : null}
          {editing?.action === "ensure" ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
              已经有同名用户时改成这里填的密码和权限并启用。
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>取消</Button>
          <Button variant="contained" color={editing?.action === "delete" ? "error" : "primary"} disabled={pending} onClick={() => void submit()}>
            {pending ? "正在改…" : "确定"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
