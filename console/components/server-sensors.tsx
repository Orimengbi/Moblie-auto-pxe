"use client";

import { useEffect, useState } from "react";
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
import type { SensorGroup, SensorRow, SensorsReading } from "@/lib/ipmi-sensors";
import { powerLevel } from "@/lib/optics";
import type { OpticsPort, OpticsReading } from "@/lib/types";
import { formatTime } from "@/lib/time";
import { useCan } from "@/components/role-context";

const MONO = "var(--font-geist-mono), monospace";

const TABLE_SX = {
  width: "100%",
  borderCollapse: "collapse",
  "& td, & th": { py: 0.5, pr: 1.5, borderBottom: 1, borderColor: "divider", fontSize: 13, textAlign: "left", verticalAlign: "top" },
  "& th": { fontWeight: 500, color: "text.secondary" },
} as const;

const GROUPS: [SensorGroup, string][] = [
  ["temperature", "温度"],
  ["fan", "风扇"],
  ["power", "功率"],
  ["voltage", "电压"],
  ["current", "电流"],
  ["state", "状态"],
  ["other", "其他"],
];

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

/** 一个口最严重的一级：收发光超出模块自己报的门限或温度超出范围算严重，离下限不到 2 dB 算警告。 */
function opticsSeverity(port: OpticsPort): SensorRow["severity"] {
  const levels = [...port.rx.map((value) => powerLevel(value, port.rxRange)), ...port.tx.map((value) => powerLevel(value, port.txRange))];
  const hot = port.temperatureC !== undefined && port.temperatureRange && (port.temperatureC < port.temperatureRange[0] || port.temperatureC > port.temperatureRange[1]);
  if (hot || levels.includes("bad")) return "critical";
  if (levels.includes("warn")) return "warning";
  return null;
}

const LEVEL_COLOR = { ok: "text.primary", warn: "warning.main", bad: "error.main" } as const;

/** 每条 lane 一个读数，按门限上色；悬停看门限。 */
function Lanes({ values, range }: { values: number[]; range?: [number, number] }) {
  if (!values.length) return <>—</>;
  return (
    <Box component="span" title={range ? `门限 ${range[0]} ~ ${range[1]} dBm` : undefined} sx={{ display: "inline-flex", flexWrap: "wrap", columnGap: 1 }}>
      {values.map((value, index) => (
        <Box key={index} component="span" sx={{ color: LEVEL_COLOR[powerLevel(value, range)] }}>
          {value}
        </Box>
      ))}
    </Box>
  );
}

function SeverityChip({ severity }: { severity: SensorRow["severity"] }) {
  return severity ? <StatusChip tone={severity === "critical" ? "error" : "warning"} label={severity === "critical" ? "严重" : "警告"} /> : null;
}

/** 光模块一组：每个口一行，只列温度和每条 lane 的发光、收光。 */
function OpticsTable({ ports, loading }: { ports: OpticsPort[]; loading: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, opacity: loading ? 0.6 : 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        光模块（{ports.length}）
      </Typography>
      <Box component="table" sx={TABLE_SX}>
        <thead>
          <tr>
            <th>端口</th>
            <th>温度</th>
            <th>发光 dBm</th>
            <th>收光 dBm</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ports.map((port) => (
            <tr key={`${port.pci}-${port.port}`}>
              <Box component="td" sx={{ fontFamily: MONO, wordBreak: "break-all" }}>
                {port.port}
                {port.rdma && port.rdma !== port.port ? (
                  <Box component="span" sx={{ color: "text.secondary" }}>
                    {" "}
                    {port.rdma}
                  </Box>
                ) : null}
              </Box>
              {port.present ? (
                <>
                  <Box component="td" sx={{ fontFamily: MONO, whiteSpace: "nowrap" }} title={port.temperatureRange ? `范围 ${port.temperatureRange[0]} ~ ${port.temperatureRange[1]} °C` : undefined}>
                    {port.temperatureC !== undefined ? `${port.temperatureC} °C` : "—"}
                  </Box>
                  <Box component="td" sx={{ fontFamily: MONO }}>
                    <Lanes values={port.tx} range={port.txRange} />
                  </Box>
                  <Box component="td" sx={{ fontFamily: MONO }}>
                    <Lanes values={port.rx} range={port.rxRange} />
                  </Box>
                </>
              ) : (
                <Box component="td" colSpan={3} sx={{ color: "text.secondary" }}>
                  读不到：{port.error || "没有模块"}
                </Box>
              )}
              <Box component="td" sx={{ width: 64 }}>
                <SeverityChip severity={port.present ? opticsSeverity(port) : null} />
              </Box>
            </tr>
          ))}
        </tbody>
      </Box>
    </Paper>
  );
}

/**
 * 侧边栏「传感器」：经 IPMI 读整张传感器表，按温度、风扇、功率、电压、状态分组，带阈值；
 * 光模块的温度和收发光 SSH 进系统读，放在温度后面。都是手动点「读取」，页面显示上次读到的。
 */
export function ServerSensors({ assetId }: { assetId: string }) {
  const [data, setData] = useState<SensorsReading | null>(null);
  const [optics, setOptics] = useState<OpticsReading | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [opticsError, setOpticsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [onlyBad, setOnlyBad] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [query, setQuery] = useState("");
  const canOperate = useCan("refresh");

  useEffect(() => {
    let alive = true;
    setData(null);
    setOptics(null);
    setLoaded(false);
    setError("");
    setOpticsError("");
    void Promise.all([api<SensorsReading | null>(`/api/assets/${assetId}/sensors`), api<OpticsReading | null>(`/api/assets/${assetId}/optics`)]).then(([sensors, ports]) => {
      if (!alive) return;
      if (sensors.ok) setData(sensors.data);
      if (ports.ok) setOptics(ports.data);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [assetId]);

  /** IPMI 两三秒，光模块要 SSH 进系统、二十来个口十几秒；两边同时读，各自报错。 */
  async function read() {
    setLoading(true);
    setError("");
    setOpticsError("");
    await Promise.all([
      api<SensorsReading>(`/api/assets/${assetId}/sensors`, "POST").then((result) => (result.ok ? setData(result.data) : setError(result.error))),
      api<OpticsReading>(`/api/assets/${assetId}/optics`, "POST").then((result) => (result.ok ? setOptics(result.data) : setOpticsError(result.error))),
    ]);
    setLoading(false);
  }

  const needle = query.trim().toLowerCase();
  const all = data?.sensors || [];
  const ports = optics?.ports || [];
  const bad = all.filter((row) => row.severity).length + ports.filter((port) => port.present && opticsSeverity(port)).length;
  const rows = all.filter((row) => (!onlyBad || row.severity) && (!hideEmpty || row.value !== null || row.group === "state") && (!needle || row.name.toLowerCase().includes(needle)));
  const shownPorts = ports.filter(
    (port) => (!onlyBad || (port.present && opticsSeverity(port))) && (!hideEmpty || port.present) && (!needle || [port.port, port.rdma || ""].some((name) => name.toLowerCase().includes(needle))),
  );
  const status = [data ? `传感器读于 ${formatTime(data.at)} · ${all.length} 个` : "", optics ? `光模块读于 ${formatTime(optics.at)}` : ""].filter(Boolean).join("；");
  const nothing = !rows.length && !shownPorts.length;

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField size="small" placeholder="搜传感器名、端口" value={query} onChange={(event) => setQuery(event.target.value)} sx={{ width: 180 }} />
        <FormControlLabel control={<Checkbox size="small" checked={onlyBad} onChange={(event) => setOnlyBad(event.target.checked)} />} label={<Typography variant="body2">只看异常（{bad}）</Typography>} />
        <FormControlLabel control={<Checkbox size="small" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />} label={<Typography variant="body2">不列没读数的</Typography>} />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {loading ? "正在读 BMC 传感器和光模块，光模块要十几秒…" : status}
        </Typography>
        {canOperate ? (
          <Button size="small" variant="contained" disabled={loading} onClick={() => void read()}>
            {loading ? "正在读取" : "读取"}
          </Button>
        ) : null}
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          传感器：{error}
        </Typography>
      ) : null}
      {opticsError ? (
        <Typography variant="body2" color="error">
          光模块：{opticsError}
        </Typography>
      ) : null}
      {loaded && !data && !optics && !loading ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          还没读过。点「读取」：传感器经 IPMI 读 BMC，光模块的温度和收发光 SSH 进系统读。
        </Typography>
      ) : null}
      {(data || optics) && nothing ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {onlyBad ? "没有异常的传感器。" : "没有符合条件的传感器。"}
        </Typography>
      ) : null}
      {GROUPS.map(([group, label]) => {
        const list = rows.filter((row) => row.group === group);
        const opticsTable = group === "temperature" && shownPorts.length ? <OpticsTable key="optics" ports={shownPorts} loading={loading} /> : null;
        if (!list.length) return opticsTable;
        return [
          <Paper key={group} variant="outlined" sx={{ p: 2, opacity: loading ? 0.6 : 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {label}（{list.length}）
            </Typography>
            <Box component="table" sx={TABLE_SX}>
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
                      <SeverityChip severity={row.severity} />
                    </Box>
                  </tr>
                ))}
              </tbody>
            </Box>
          </Paper>,
          opticsTable,
        ];
      })}
    </Stack>
  );
}
