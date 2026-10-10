"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormLabel from "@mui/material/FormLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ASSET_STATUS } from "@/lib/asset-labels";
import type { AssetStatus, MonitorSettings } from "@/lib/types";

/** 监控设置：开关、间隔、监控哪些状态的资产、GPU 温度线、不报的传感器。 */
export function MonitorSettingsForm({ settings }: { settings: MonitorSettings }) {
  const [form, setForm] = useState(settings);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/settings/monitor", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(body?.error || "保存失败");
      setMessage("");
      return;
    }
    setForm(body as MonitorSettings);
    setError("");
    setMessage("已保存，下一轮检查（30 秒内）按新设置跑");
  }

  const num = (key: "bmcIntervalMin" | "osIntervalMin" | "gpuTempWarn" | "bmcFailuresToAlert") => ({
    value: String(form[key]),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: Number(event.target.value) }),
  });

  return (
    <Stack component="form" onSubmit={save} spacing={2.5} sx={{ maxWidth: 768 }}>
      <FormControlLabel control={<Switch checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />} label="打开定时监控" />
      <Box>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField label="BMC 间隔（分钟）" type="number" slotProps={{ htmlInput: { min: 1 } }} fullWidth {...num("bmcIntervalMin")} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField label="系统内间隔（分钟）" type="number" slotProps={{ htmlInput: { min: 0 } }} fullWidth {...num("osIntervalMin")} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField label="GPU 温度告警（°C）" type="number" fullWidth {...num("gpuTempWarn")} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField label="BMC 连续不通几次报" type="number" slotProps={{ htmlInput: { min: 1 } }} fullWidth {...num("bmcFailuresToAlert")} />
          </Grid>
        </Grid>
        <Typography variant="caption" sx={{ display: "block", mt: 1, color: "text.secondary" }}>
          系统内间隔填 0 就不 SSH 进系统查 GPU 和硬盘。系统内检查要能用控制台的密钥登录（装机时写入的公钥）。
        </Typography>
      </Box>
      <Box>
        <FormControlLabel
          control={<Switch checked={form.redfishEvents} onChange={(event) => setForm({ ...form, redfishEvents: event.target.checked })} />}
          label="实时接收 BMC 事件（Redfish SSE）"
        />
        <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
          控制台和每台被监控服务器的 BMC 保持一条连接，BMC 一有事件就收到，严重和警告的直接开告警。不需要 BMC 能连回控制台。
        </Typography>
      </Box>
      <FormControl component="fieldset">
        <FormLabel component="legend" sx={{ typography: "subtitle2", color: "text.primary", mb: 0.5 }}>
          监控哪些状态的资产
        </FormLabel>
        <FormGroup row>
          {(Object.keys(ASSET_STATUS) as AssetStatus[]).map((status) => (
            <FormControlLabel
              key={status}
              label={ASSET_STATUS[status]}
              control={
                <Checkbox
                  checked={form.statuses.includes(status)}
                  onChange={(event) => setForm({ ...form, statuses: event.target.checked ? [...form.statuses, status] : form.statuses.filter((item) => item !== status) })}
                />
              }
            />
          ))}
        </FormGroup>
      </FormControl>
      <TextField
        label="不报的传感器"
        value={form.ignoreSensors}
        onChange={(event) => setForm({ ...form, ignoreSensors: event.target.value })}
        multiline
        minRows={2}
        fullWidth
        placeholder="逗号或换行分开，可以用 *，例如 PSU*_Fan_Fail, CHASSIS_INTRU"
        slotProps={{ htmlInput: { style: { fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 } } }}
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
        <Button type="submit" variant="contained">
          保存
        </Button>
      </Box>
    </Stack>
  );
}
