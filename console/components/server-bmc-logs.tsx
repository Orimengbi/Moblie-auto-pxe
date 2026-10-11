"use client";

import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { EventStreamLine, healthTone } from "@/components/server-bmc";
import type { LogEntryView, LogServiceView } from "@/lib/bmc-redfish";
import { api } from "@/lib/client-api";
import type { BmcEvent, StreamStatus } from "@/lib/redfish-events";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";
const PAGE = 50;

function Entry({ at, severity, title, detail, hint }: { at: string; severity: string; title: string; detail: string; hint?: string }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ py: 0.75, borderBottom: 1, borderColor: "divider", alignItems: "flex-start" }}>
      <Typography variant="caption" sx={{ fontFamily: MONO, color: "text.secondary", width: 132, flexShrink: 0, pt: 0.25 }}>
        {at ? formatTime(at) : "—"}
      </Typography>
      <Box sx={{ width: 72, flexShrink: 0 }}>
        <StatusChip tone={healthTone(severity)} label={severity || "—"} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
          {title}
        </Typography>
        {detail ? (
          <Typography variant="caption" sx={{ fontFamily: MONO, color: "text.secondary" }}>
            {detail}
          </Typography>
        ) : null}
        {hint ? (
          <Typography variant="caption" component="div" sx={{ color: "text.secondary" }}>
            处理建议：{hint}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

/** HGX 的日志前面标出来源（HGX_BMC_0、HGX_Baseboard_0），主 BMC、主系统的按 BMC / 主机。 */
function serviceLabel(item: LogServiceView): string {
  const owner = item.source ? item.source.replace(/^HGX_Baseboard_\d+$/, "HGX 底板").replace(/^HGX_BMC_\d+$/, "HGX BMC") : item.owner === "manager" ? "BMC" : "主机";
  return `${owner} · ${item.name}`;
}

/** AMI 的 SEL 把 IPMI 字段拼成一长串，挑出有用的几个。 */
function selSummary(entry: LogEntryView): string {
  if (!/Sensor_Type\s*:/.test(entry.message)) return entry.message;
  const field = (name: string) => entry.message.match(new RegExp(`${name}\\s*:\\s*([^,]+)`))?.[1]?.trim() || "";
  return [field("Sensor_Type"), field("Sensor_Name") !== "Unknown" ? field("Sensor_Name") : "", field("Event_Type"), field("Event_Dir")].filter(Boolean).join(" · ");
}

/** 侧边栏「BMC 日志」：实时推来的事件，以及 BMC 上各个日志（SEL、事件、审计、BIOS…）按页翻。 */
export function ServerBmcLogs({ assetId }: { assetId: string }) {
  const [stream, setStream] = useState<{ stream: StreamStatus; events: BmcEvent[] } | null>(null);
  const [services, setServices] = useState<LogServiceView[] | null>(null);
  const [service, setService] = useState("");
  const [page, setPage] = useState(0);
  const [log, setLog] = useState<{ total: number; entries: LogEntryView[]; sorted: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [alertsOnly, setAlertsOnly] = useState(false);

  const loadEvents = useCallback(async () => {
    const result = await api<{ stream: StreamStatus; events: BmcEvent[] }>(`/api/assets/${assetId}/redfish/events`);
    if (result.ok) setStream(result.data);
  }, [assetId]);

  useEffect(() => {
    void loadEvents();
    const timer = setInterval(() => void loadEvents(), 15_000);
    return () => clearInterval(timer);
  }, [loadEvents]);

  useEffect(() => {
    void (async () => {
      const result = await api<{ services: LogServiceView[] }>(`/api/assets/${assetId}/redfish/logs`);
      if (!result.ok) return setError(result.error);
      setServices(result.data.services);
      const first = result.data.services.find((item) => item.id === "ipmi-sel") || result.data.services.find((item) => item.id === "SEL") || result.data.services.find((item) => item.count) || result.data.services[0];
      if (first) setService(first.path);
    })();
  }, [assetId]);

  const loadLog = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    const result = await api<{ total: number; entries: LogEntryView[]; sorted: boolean }>(
      `/api/assets/${assetId}/redfish/logs?service=${encodeURIComponent(service)}&page=${page}${alertsOnly ? "&alerts=1" : ""}`,
    );
    setLoading(false);
    if (result.ok) setLog(result.data);
    setError(result.error);
  }, [assetId, service, page, alertsOnly]);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  async function clear() {
    const name = services?.find((item) => item.path === service)?.name || service;
    if (!window.confirm(`清空 BMC 上的「${name}」？清掉就找不回来了。`)) return;
    const result = await api(`/api/assets/${assetId}/redfish/logs?service=${encodeURIComponent(service)}`, "DELETE");
    setError(result.error);
    if (result.ok) {
      setPage(0);
      await loadLog();
    }
  }

  const current = services?.find((item) => item.path === service);
  const pages = log ? Math.max(1, Math.ceil(log.total / PAGE)) : 1;

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">实时事件</Typography>
        {stream ? <EventStreamLine status={stream.stream} /> : null}
        {stream?.events.length ? (
          <Box sx={{ mt: 1, maxHeight: 280, overflowY: "auto" }}>
            {stream.events.map((event) => (
              <Entry key={event.id} at={event.at} severity={event.severity} title={event.message || event.messageId} detail={[event.messageId, event.origin].filter(Boolean).join("  ")} />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ mt: 1, color: "text.secondary" }}>
            还没收到过
          </Typography>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center", mb: 1 }}>
          <TextField
            select
            size="small"
            label="BMC 上的日志"
            value={service}
            onChange={(event) => {
              setService(event.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 240 }}
            disabled={!services?.length}
          >
            {(services || []).map((item) => (
              <MenuItem key={item.path} value={item.path}>
                {serviceLabel(item)}
                {item.count !== null ? `（${item.count}）` : ""}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={alertsOnly}
                onChange={(event) => {
                  setAlertsOnly(event.target.checked);
                  setPage(0);
                }}
              />
            }
            label={<Typography variant="body2">只看告警</Typography>}
          />
          <Box sx={{ flex: 1 }} />
          <Button size="small" disabled={loading || page === 0} onClick={() => setPage(page - 1)}>
            较新
          </Button>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {page + 1} / {pages}
          </Typography>
          <Button size="small" disabled={loading || page + 1 >= pages} onClick={() => setPage(page + 1)}>
            较旧
          </Button>
          <Button size="small" disabled={loading} onClick={() => void loadLog()}>
            刷新
          </Button>
          {current?.canClear ? (
            <Button size="small" color="warning" onClick={() => void clear()}>
              清空
            </Button>
          ) : null}
        </Stack>
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}
        {!services && !error ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            正在读日志列表
          </Typography>
        ) : null}
        {log && !log.sorted && log.entries.length ? (
          <Typography variant="caption" sx={{ display: "block", mb: 1, color: "text.secondary" }}>
            日志太大，按编号倒着翻{alertsOnly ? "，只看告警也只筛当前这一页" : ""}
          </Typography>
        ) : null}
        {log ? (
          log.entries.length ? (
            <Box sx={{ opacity: loading ? 0.5 : 1 }}>
              {log.entries.map((entry) => (
                <Entry
                  key={entry.id}
                  at={entry.created}
                  severity={entry.severity}
                  title={selSummary(entry)}
                  detail={[entry.id && `#${entry.id}`, entry.device, entry.messageId !== "0x000000" ? entry.messageId : "", entry.sensor, entry.resolved === true ? "已恢复" : entry.resolved === false && entry.entryType === "SEL" ? "未恢复" : ""].filter(Boolean).join("  ")}
                  hint={entry.resolution}
                />
              ))}
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {alertsOnly ? (log.sorted ? "这个日志里没有告警" : "这一页里没有告警") : "这个日志是空的"}
            </Typography>
          )
        ) : null}
      </Paper>
    </Stack>
  );
}
