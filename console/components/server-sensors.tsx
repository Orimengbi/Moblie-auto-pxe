"use client";

import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { api } from "@/lib/client-api";
import type { SensorGroup, SensorRow } from "@/lib/ipmi-sensors";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";

const GROUPS: [SensorGroup, string][] = [
  ["temperature", "温度"],
  ["fan", "风扇"],
  ["power", "功率"],
  ["voltage", "电压"],
  ["current", "电流"],
  ["state", "状态"],
  ["other", "其他"],
];

/** 自动刷新的间隔。读一次两三秒，BMC 扛得住。 */
const AUTO_MS = 30_000;

function shown(value: number | null, unit: string): string {
  if (value === null) return "—";
  const text = Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 3 : 1).replace(/\.?0+$/, "");
  return `${text}${unit ? ` ${unit}` : ""}`;
}

/** 阈值写成「下严重 / 下警告 ~ 上警告 / 上严重」，没有的不写。 */
function limits(row: SensorRow): string {
  const t = row.thresholds;
  const low = [t.lc ?? t.lnr, t.lnc].filter((item) => item !== null).join(" / ");
  const high = [t.unc, t.uc ?? t.unr].filter((item) => item !== null).join(" / ");
  if (!low && !high) return "";
  return `${low || "—"} ~ ${high || "—"}`;
}

/** 数值离上限多近：有上限严重值时画一条，到警告线变黄、到严重线变红。 */
function Meter({ row }: { row: SensorRow }) {
  const top = row.thresholds.uc ?? row.thresholds.unr;
  if (row.value === null || top === null || top <= 0 || row.group === "voltage") return null;
  const percent = Math.max(0, Math.min(100, (row.value / top) * 100));
  const color = row.severity === "critical" ? "error" : row.severity === "warning" || (row.thresholds.unc !== null && row.value >= row.thresholds.unc) ? "warning" : "primary";
  return <LinearProgress variant="determinate" value={percent} color={color} sx={{ height: 4, borderRadius: 2, mt: 0.5 }} />;
}

/** 侧边栏「传感器」：经 IPMI 读整张传感器表，按温度、风扇、功率、电压、状态分组，带阈值。打开时读一次，可以自动刷新。 */
export function ServerSensors({ assetId }: { assetId: string }) {
  const [data, setData] = useState<{ at: string; sensors: SensorRow[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(false);
  const [onlyBad, setOnlyBad] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api<{ at: string; sensors: SensorRow[] }>(`/api/assets/${assetId}/sensors`);
    setLoading(false);
    if (result.ok) setData(result.data);
    setError(result.error);
  }, [assetId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void load(), AUTO_MS);
    return () => clearInterval(timer);
  }, [auto, load]);

  const needle = query.trim().toLowerCase();
  const all = data?.sensors || [];
  const bad = all.filter((row) => row.severity);
  const rows = all.filter((row) => (!onlyBad || row.severity) && (!hideEmpty || row.value !== null || row.group === "state") && (!needle || row.name.toLowerCase().includes(needle)));

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField size="small" placeholder="搜传感器名" value={query} onChange={(event) => setQuery(event.target.value)} sx={{ width: 180 }} />
        <FormControlLabel control={<Checkbox size="small" checked={onlyBad} onChange={(event) => setOnlyBad(event.target.checked)} />} label={<Typography variant="body2">只看异常（{bad.length}）</Typography>} />
        <FormControlLabel control={<Checkbox size="small" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />} label={<Typography variant="body2">不列没读数的</Typography>} />
        <FormControlLabel control={<Checkbox size="small" checked={auto} onChange={(event) => setAuto(event.target.checked)} />} label={<Typography variant="body2">每 30 秒刷新</Typography>} />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {loading ? "正在从 BMC 读…" : data ? `读于 ${formatTime(data.at, "time")} · ${all.length} 个` : ""}
        </Typography>
        <Button size="small" variant="outlined" disabled={loading} onClick={() => void load()}>
          刷新
        </Button>
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {!data && !error ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          正在经 IPMI 读传感器
        </Typography>
      ) : null}
      {data && !rows.length ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {onlyBad ? "没有异常的传感器。" : "没有符合条件的传感器。"}
        </Typography>
      ) : null}
      {GROUPS.map(([group, label]) => {
        const list = rows.filter((row) => row.group === group);
        if (!list.length) return null;
        return (
          <Paper key={group} variant="outlined" sx={{ p: 2, opacity: loading ? 0.6 : 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {label}（{list.length}）
            </Typography>
            <Box
              component="table"
              sx={{ width: "100%", borderCollapse: "collapse", "& td, & th": { py: 0.5, pr: 1.5, borderBottom: 1, borderColor: "divider", fontSize: 13, textAlign: "left", verticalAlign: "top" }, "& th": { fontWeight: 500, color: "text.secondary" } }}
            >
              <thead>
                <tr>
                  <th>名称</th>
                  <th>{group === "state" ? "状态" : "读数"}</th>
                  {group === "state" ? null : <th>阈值（下 ~ 上，警告 / 严重）</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.name}>
                    <Box component="td" sx={{ fontFamily: MONO, wordBreak: "break-all" }}>
                      {row.name}
                    </Box>
                    <Box component="td" sx={{ fontFamily: group === "state" ? undefined : MONO, minWidth: 96 }}>
                      {group === "state" ? row.text || "—" : shown(row.value, row.unit)}
                      {group === "state" ? null : <Meter row={row} />}
                    </Box>
                    {group === "state" ? null : (
                      <Box component="td" sx={{ fontFamily: MONO, color: "text.secondary", whiteSpace: "nowrap" }}>
                        {limits(row)}
                      </Box>
                    )}
                    <Box component="td" sx={{ width: 64 }}>
                      {row.severity ? <StatusChip tone={row.severity === "critical" ? "error" : "warning"} label={row.severity === "critical" ? "严重" : "警告"} /> : null}
                    </Box>
                  </tr>
                ))}
              </tbody>
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
}
