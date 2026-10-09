"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { alertAction } from "@/components/alert-board";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { ALERT_SEVERITY, ALERT_SEVERITY_TONE, ALERT_STATUS } from "@/lib/asset-labels";
import type { Alert, MonitorState } from "@/lib/types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";
const LIST = { m: 0, p: 0, listStyle: "none" } as const;

interface View {
  state: MonitorState;
  alerts: Alert[];
  monitored?: boolean;
}

function when(at: string): string {
  return at ? formatTime(at) : "还没查过";
}

/** 侧边栏「监控」：这台的告警、传感器（异常的在前）、最近的 BMC 事件、GPU 和硬盘。 */
export function AssetMonitor({ assetId }: { assetId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [allSensors, setAllSensors] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/assets/${assetId}/monitor`).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setError(body?.error || "读取失败");
    else setView(body as View);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkNow() {
    setChecking(true);
    setError("");
    const response = await fetch(`/api/assets/${assetId}/monitor`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setChecking(false);
    if (!response?.ok) setError(body?.error || "检查失败");
    await load();
  }

  async function act(alert: Alert, action: "ack" | "resolve" | "ticket") {
    const result = await alertAction(alert.id, action);
    setError(result.error);
    await load();
  }

  if (!view)
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {error || "正在读取"}
      </Typography>
    );
  const { state } = view;
  const open = view.alerts.filter((alert) => alert.status !== "resolved");
  const bad = state.sensors.filter((sensor) => sensor.severity);
  const sensors = allSensors ? state.sensors : bad;
  // 异常程度对应的字色：严重红字，警告加粗。
  const severityStyle = (severity: string | null, normal: object = {}) => (severity === "critical" ? { color: "error.main" } : severity === "warning" ? { fontWeight: 600 } : normal);

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {view.monitored === false ? "这台的状态不在监控范围里，只能手动检查。" : ""}BMC {when(state.bmcAt)}
          {state.bmcAt ? (state.bmcOk ? "，正常" : `，${state.bmcError}`) : ""}；系统内 {when(state.osAt)}
          {state.osAt ? (state.osOk ? "，正常" : `，${state.osError}`) : ""}
        </Typography>
        <Button variant="contained" sx={{ ml: "auto" }} disabled={checking} onClick={() => void checkNow()}>
          {checking ? "检查中，读 BMC 要几十秒" : "立即检查"}
        </Button>
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}

      <Stack spacing={1}>
        <Typography variant="subtitle2">告警{open.length ? `（${open.length}）` : ""}</Typography>
        {view.alerts.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            没有告警。
          </Typography>
        ) : null}
        {view.alerts.slice(0, 30).map((alert) => (
          <Paper key={alert.id} variant="outlined" sx={{ p: 1, opacity: alert.status === "resolved" ? 0.6 : 1 }}>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <StatusChip tone={ALERT_SEVERITY_TONE[alert.severity]} label={ALERT_SEVERITY[alert.severity]} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {alert.title}
              </Typography>
              {alert.count > 1 ? (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  ×{alert.count}
                </Typography>
              ) : null}
              <Typography variant="caption" sx={{ ml: "auto", color: "text.secondary" }}>
                {ALERT_STATUS[alert.status]}
              </Typography>
            </Stack>
            <Typography variant="caption" component="p" sx={{ mt: 0.5, wordBreak: "break-all", color: "text.secondary" }}>
              {alert.detail}
            </Typography>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", mt: 0.5 }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {formatTime(alert.firstAt)}
              </Typography>
              {alert.ticketId ? (
                <MuiLink component={Link} href={`/tickets/${alert.ticketId}`} variant="caption" sx={{ ml: 1 }}>
                  看工单
                </MuiLink>
              ) : null}
              <Stack direction="row" spacing={0.5} sx={{ ml: "auto" }}>
                {alert.status === "active" ? <Button onClick={() => void act(alert, "ack")}>确认</Button> : null}
                {alert.status !== "resolved" && !alert.ticketId ? <Button onClick={() => void act(alert, "ticket")}>转工单</Button> : null}
                {alert.status !== "resolved" ? <Button onClick={() => void act(alert, "resolve")}>处理完</Button> : null}
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2">
            传感器（{state.sensors.length} 个，异常 {bad.length} 个）
          </Typography>
          {state.sensors.length ? (
            <FormControlLabel
              sx={{ ml: "auto", mr: 0 }}
              control={<Checkbox checked={allSensors} onChange={(event) => setAllSensors(event.target.checked)} />}
              label={
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  显示全部
                </Typography>
              }
            />
          ) : null}
        </Stack>
        {sensors.length ? (
          <Box component="ul" sx={{ ...LIST, fontFamily: MONO, fontSize: 12 }}>
            {sensors.map((sensor) => (
              <Box component="li" key={sensor.name} sx={{ display: "grid", gridTemplateColumns: "12rem 3rem minmax(0, 1fr)", gap: 1, ...severityStyle(sensor.severity) }}>
                <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sensor.name}
                </Box>
                <span>{sensor.status}</span>
                <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sensor.reading}
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {state.sensors.length ? "都正常。" : "还没读到。"}
          </Typography>
        )}
      </Stack>

      {state.selRecent.length ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">最近的 BMC 事件</Typography>
          <Box component="ul" sx={{ ...LIST, fontSize: 12 }}>
            {[...state.selRecent]
              .reverse()
              .slice(0, 30)
              .map((entry) => (
                <Box component="li" key={`${entry.id}-${entry.at}`} sx={severityStyle(entry.severity, { color: "text.secondary" })}>
                  {entry.at} · {entry.sensor} · {entry.event} · {entry.direction}
                </Box>
              ))}
          </Box>
        </Stack>
      ) : null}

      {state.gpus.length || state.disks.length ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">系统内</Typography>
          <Box component="ul" sx={{ ...LIST, fontFamily: MONO, fontSize: 12 }}>
            {state.gpus.map((gpu) => (
              <li key={gpu.bus}>
                GPU {gpu.index} {gpu.bus} {gpu.temperature ?? "?"}°C ECC {gpu.eccUncorrected ?? "?"}
              </li>
            ))}
            {state.disks.map((disk) => (
              <Box component="li" key={disk.name} sx={{ color: disk.ok ? undefined : "error.main" }}>
                {disk.name} {disk.health}
              </Box>
            ))}
          </Box>
        </Stack>
      ) : null}
    </Stack>
  );
}
