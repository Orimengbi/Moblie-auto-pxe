"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/lib/client-api";
import { formatTime, setDisplayTimeZone, TIME_ZONES } from "@/lib/time";

/** 控制台显示时区：页面上所有时间按这个时区显示。列表里没有的可以直接填 IANA 名字。 */
export function DisplaySettingsForm({ timeZone }: { timeZone: string }) {
  const router = useRouter();
  const known = TIME_ZONES.some(([value]) => value === timeZone);
  const [choice, setChoice] = useState(known ? timeZone : "other");
  const [custom, setCustom] = useState(known ? "" : timeZone);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const zone = choice === "other" ? custom.trim() : choice;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = await api<{ timeZone: string }>("/api/settings/display", "PUT", { timeZone: zone });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      setMessage("");
      return;
    }
    setDisplayTimeZone(result.data.timeZone);
    setError("");
    setMessage(`已保存，现在是 ${formatTime(new Date())}`);
    router.refresh();
  }

  return (
    <Stack component="form" onSubmit={save} spacing={2} sx={{ maxWidth: 560 }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        页面上的时间（告警、记录、任务、日志等）都按这个时区显示。BMC 自己的时区在资产的 BMC 页里改。
      </Typography>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <TextField select label="显示时区" value={choice} onChange={(event) => setChoice(event.target.value)} sx={{ minWidth: 260 }}>
          {TIME_ZONES.map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
          <MenuItem value="other">其他（手填）</MenuItem>
        </TextField>
        {choice === "other" ? <TextField label="IANA 时区名" placeholder="如 Asia/Bangkok" value={custom} onChange={(event) => setCustom(event.target.value)} /> : null}
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {message ? (
        <Typography variant="body2" sx={{ color: "success.main" }}>
          {message}
        </Typography>
      ) : null}
      <div>
        <Button type="submit" variant="contained" disabled={saving || !zone}>
          保存
        </Button>
      </div>
    </Stack>
  );
}
