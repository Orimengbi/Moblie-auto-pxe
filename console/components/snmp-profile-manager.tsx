"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { PublicSnmpProfile } from "@/lib/types";

const NATIVE = { select: { native: true } } as const;

const BLANK = { name: "", version: "v2c", community: "", username: "", authProto: "SHA", authPass: "", privProto: "AES", privPass: "" };

/** SNMP 凭据：交换机、PDU 选用其中一套。密码保存后不再显示，留空表示不改。 */
export function SnmpProfileManager({ profiles }: { profiles: PublicSnmpProfile[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState("");

  function start(profile: PublicSnmpProfile | null) {
    setEditing(profile?.id || "new");
    setForm(profile ? { ...BLANK, name: profile.name, version: profile.version, username: profile.username, authProto: profile.authProto, privProto: profile.privProto } : BLANK);
    setError("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(editing === "new" ? "/api/snmp-profiles" : `/api/snmp-profiles/${editing}`, {
      method: editing === "new" ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(body?.error || "保存失败");
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function remove(profile: PublicSnmpProfile) {
    if (!window.confirm(`删除凭据「${profile.name}」？`)) return;
    const response = await fetch(`/api/snmp-profiles/${profile.id}`, { method: "DELETE" }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setError(response?.ok ? "" : body?.error || "删除失败");
    router.refresh();
  }

  const field = (key: keyof typeof BLANK) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value }), fullWidth: true });
  const isNew = editing === "new";

  const errorText = error ? (
    <Typography variant="body2" color="error">
      {error}
    </Typography>
  ) : null;

  return (
    <Stack spacing={2} sx={{ maxWidth: 768 }}>
      <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: "none" }}>
        {profiles.map((profile) => (
          <Stack component="li" key={profile.id} direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {profile.name}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {profile.version === "v2c" ? "v2c" : `v3 · ${profile.username} · ${profile.authProto || "不认证"} / ${profile.privProto || "不加密"}`}
            </Typography>
            <Button type="button" onClick={() => start(profile)}>
              编辑
            </Button>
            <Button type="button" color="error" onClick={() => void remove(profile)}>
              删除
            </Button>
          </Stack>
        ))}
        {profiles.length === 0 ? (
          <Typography component="li" variant="body2" sx={{ color: "text.secondary" }}>
            还没有凭据。交换机上开 SNMP（只读即可）后在这里建一套。
          </Typography>
        ) : null}
      </Stack>
      {editing ? (
        <Paper variant="outlined" component="form" onSubmit={save} sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="名称" {...field("name")} required placeholder="例如 机房只读 v3" />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField select slotProps={NATIVE} label="版本" {...field("version")}>
                  <option value="v2c">v2c</option>
                  <option value="v3">v3</option>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                {form.version === "v2c" ? (
                  <TextField label="Community" {...field("community")} type="password" autoComplete="new-password" placeholder={isNew ? "" : "留空不改"} required={isNew} />
                ) : (
                  <TextField label="用户名" {...field("username")} required />
                )}
              </Grid>
            </Grid>
            {form.version === "v3" ? (
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField select slotProps={NATIVE} label="认证" {...field("authProto")}>
                    <option value="">不认证</option>
                    {["MD5", "SHA", "SHA-256", "SHA-512"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField label="认证密码" {...field("authPass")} type="password" autoComplete="new-password" placeholder={isNew ? "至少 8 位" : "留空不改"} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField select slotProps={NATIVE} label="加密" {...field("privProto")}>
                    <option value="">不加密</option>
                    {["DES", "AES", "AES-256"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField label="加密密码" {...field("privPass")} type="password" autoComplete="new-password" placeholder={isNew ? "至少 8 位" : "留空不改"} />
                </Grid>
              </Grid>
            ) : null}
            {errorText}
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained">
                保存
              </Button>
              <Button type="button" onClick={() => setEditing(null)}>
                取消
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : (
        <Box>
          <Button type="button" variant="outlined" onClick={() => start(null)}>
            新建凭据
          </Button>
          {error ? <Box sx={{ mt: 1 }}>{errorText}</Box> : null}
        </Box>
      )}
    </Stack>
  );
}
