"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { PublicUser } from "@/lib/auth";
import { api } from "@/lib/client-api";

const MONO = "var(--font-geist-mono), monospace";

/** 已有的一把公钥或访问密钥：名称、摘要，右边删除。 */
function KeyRow({ name, detail, truncate, disabled, onRemove }: { name: string; detail: React.ReactNode; truncate?: boolean; disabled: boolean; onRemove: () => void }) {
  return (
    <Stack component="li" direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", borderRadius: 2, bgcolor: "action.hover", px: 1.5, py: 1 }}>
      <Box sx={{ minWidth: 0, flex: truncate ? 1 : undefined }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {name}
        </Typography>
        <Typography variant="caption" component="p" noWrap={truncate} sx={{ fontFamily: MONO, color: "text.secondary" }}>
          {detail}
        </Typography>
      </Box>
      <Button color="error" disabled={disabled} onClick={onRemove}>
        删除
      </Button>
    </Stack>
  );
}

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
    <Stack spacing={4}>
      <Stack component="section" spacing={1.5}>
        <Typography variant="h3">SSH 公钥</Typography>
        {user.sshKeys.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            还没有公钥。添加后可以在登录页用 ssh-keygen 签名登录。
          </Typography>
        ) : (
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: "none" }}>
            {user.sshKeys.map((key) => (
              <KeyRow
                key={key.id}
                name={key.name}
                truncate
                detail={`${key.publicKey.split(" ")[0]} ${key.fingerprint} · 添加于 ${day(key.createdAt)}`}
                disabled={pending}
                onRemove={() => remove("ssh-keys", key.id, key.name)}
              />
            ))}
          </Stack>
        )}
        <Stack component="form" onSubmit={addSsh} spacing={1.5}>
          <TextField
            value={sshKey}
            onChange={(event) => setSshKey(event.target.value)}
            placeholder="ssh-ed25519 AAAA... user@host（~/.ssh/id_ed25519.pub 的内容）"
            multiline
            minRows={3}
            fullWidth
            required
            slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 12 } } }}
          />
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <TextField value={sshName} onChange={(event) => setSshName(event.target.value)} placeholder="名称（可不填，默认用公钥注释）" sx={{ width: 320, maxWidth: "100%" }} />
            <Button type="submit" variant="outlined" disabled={pending}>
              添加公钥
            </Button>
          </Stack>
        </Stack>
      </Stack>

      <Stack component="section" spacing={1.5}>
        <Typography variant="h3">访问密钥</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          可以在登录页直接粘贴登录，也可以给脚本用：
          <Box component="code" sx={{ fontFamily: MONO, fontSize: 12 }}>
            curl -H &quot;Authorization: Bearer pxe_...&quot;
          </Box>
          。权限和这个用户相同。
        </Typography>
        {user.accessKeys.length ? (
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: "none" }}>
            {user.accessKeys.map((key) => (
              <KeyRow
                key={key.id}
                name={key.name}
                detail={`pxe_${key.id}_… · 创建于 ${day(key.createdAt)} · 最近使用 ${day(key.lastUsedAt)}`}
                disabled={pending}
                onRemove={() => remove("access-keys", key.id, key.name)}
              />
            ))}
          </Stack>
        ) : null}
        <Stack component="form" onSubmit={addAccessKey} direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <TextField value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="用途，例如 笔记本 / 巡检脚本" sx={{ width: 320, maxWidth: "100%" }} />
          <Button type="submit" variant="outlined" disabled={pending}>
            生成访问密钥
          </Button>
        </Stack>
      </Stack>

      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}

      <Dialog open={Boolean(created)} onClose={() => setCreated("")}>
        <DialogTitle>新的访问密钥</DialogTitle>
        <DialogContent>
          <DialogContentText variant="body2" sx={{ mb: 1.5 }}>
            只显示这一次，关掉后无法再查看。丢了就删掉重新生成。
          </DialogContentText>
          <Box
            component="pre"
            sx={{ m: 0, p: 1.5, overflowX: "auto", borderRadius: 2, bgcolor: "action.hover", fontFamily: MONO, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "all" }}
          >
            {created}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => navigator.clipboard?.writeText(created)}>
            复制
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
