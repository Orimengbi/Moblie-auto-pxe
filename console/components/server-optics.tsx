"use client";

import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useGridColumnWidths } from "@/components/server-inventory";
import { groupModules, powerLevel, type OpticsModule } from "@/lib/optics";
import type { OpticsPort, OpticsReading } from "@/lib/types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";

/** 表格的一行：一个光模块，或一个读不到的口（占满后面几列显示原因）。 */
type Row = { id: string; module: OpticsModule; port?: undefined } | { id: string; module?: undefined; port: OpticsPort };

const LEVEL_COLOR = { ok: "success", warn: "warning", bad: "error" } as const;

/** 浅底深字的读数色块，深色模式下字用浅一档的颜色。 */
function levelSx(level: keyof typeof LEVEL_COLOR) {
  const color = LEVEL_COLOR[level];
  return (theme: Theme) => {
    const palette = (theme.vars || theme).palette[color];
    return { bgcolor: theme.alpha(palette.main, 0.16), color: palette.dark, ...theme.applyStyles("dark", { color: palette.light }) };
  };
}

function Lanes({ values, range, label }: { values: number[]; range?: [number, number]; label: string }) {
  if (!values.length)
    return (
      <Box component="span" sx={{ color: "text.secondary" }}>
        —
      </Box>
    );
  return (
    <Box component="span" sx={{ display: "inline-flex", flexWrap: "wrap", gap: 0.5 }} title={range ? `${label}告警门限 ${range[0]} ~ ${range[1]} dBm` : undefined}>
      {values.map((value, index) => (
        <Box key={index} component="span" sx={[{ borderRadius: 0.5, px: 0.5, fontFamily: MONO }, levelSx(powerLevel(value, range))]}>
          {value}
        </Box>
      ))}
    </Box>
  );
}

/** 一个模块的收光或发光：每个口一行，口多于一个时前面标上口名。 */
function ModuleLanes({ group, kind }: { group: OpticsModule; kind: "rx" | "tx" }) {
  const label = kind === "rx" ? "收光" : "发光";
  return (
    <Stack spacing={0.5}>
      {group.ports.map((port) => (
        <Stack key={port.pci} direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
          {group.ports.length > 1 ? (
            <Box component="span" sx={{ fontFamily: MONO, color: "text.secondary" }}>
              {port.port}
            </Box>
          ) : null}
          <Lanes values={port[kind]} range={kind === "rx" ? port.rxRange : port.txRange} label={label} />
        </Stack>
      ))}
    </Stack>
  );
}

/** 端口名加上 RDMA 设备名和 PCI 地址。 */
function PortName({ port }: { port: OpticsPort }) {
  return (
    <Box sx={{ fontFamily: MONO }}>
      {port.port}
      <Box component="span" sx={{ color: "text.secondary" }}>
        {" "}
        {[port.rdma, port.pci.replace(/^0000:/, "")].filter(Boolean).join(" · ")}
      </Box>
    </Box>
  );
}

const COLUMNS: GridColDef<Row>[] = [
  {
    field: "port",
    headerName: "端口",
    width: 200,
    renderCell: ({ row }) => (row.module ? <Box>{row.module.ports.map((port) => <PortName key={port.pci} port={port} />)}</Box> : <PortName port={row.port} />),
  },
  {
    field: "group",
    headerName: "模块",
    flex: 1,
    minWidth: 220,
    colSpan: (_value, row) => (row.module ? 1 : 5),
    renderCell: ({ row }) => {
      if (!row.module)
        return (
          <Box component="span" sx={{ color: "error.main" }}>
            读不到：{row.port.error}
          </Box>
        );
      const info = row.module.info;
      return (
        <Box>
          <div>{[info.vendor, info.model].filter(Boolean).join(" ") || "—"}</div>
          <Box sx={{ color: "text.secondary" }}>
            {[info.type, info.compliance, info.wavelengthNm ? `${info.wavelengthNm} nm` : "", info.length, info.firmware && `固件 ${info.firmware}`].filter(Boolean).join(" · ")}
          </Box>
        </Box>
      );
    },
  },
  {
    field: "sn",
    headerName: "序列号",
    width: 160,
    renderCell: ({ row }) => (
      <Box component="span" sx={{ fontFamily: MONO }}>
        {row.module?.info.sn || "—"}
      </Box>
    ),
  },
  {
    field: "temp",
    headerName: "温度",
    width: 90,
    renderCell: ({ row }) => {
      const info = row.module?.info;
      if (!info) return null;
      return (
        <Box>
          {info.temperatureC !== undefined ? `${info.temperatureC} ℃` : "—"}
          {info.voltageV !== undefined ? <Box sx={{ color: "text.secondary" }}>{info.voltageV} V</Box> : null}
        </Box>
      );
    },
  },
  { field: "tx", headerName: "发光 dBm", width: 200, renderCell: ({ row }) => (row.module ? <ModuleLanes group={row.module} kind="tx" /> : null) },
  { field: "rx", headerName: "收光 dBm", width: 200, renderCell: ({ row }) => (row.module ? <ModuleLanes group={row.module} kind="rx" /> : null) },
];

function summary(ports: OpticsPort[]): string {
  const present = ports.filter((port) => port.present);
  const modules = groupModules(ports).length;
  const levels = present.flatMap((port) => [...port.rx.map((value) => powerLevel(value, port.rxRange)), ...port.tx.map((value) => powerLevel(value, port.txRange))]);
  const bad = levels.filter((level) => level === "bad").length;
  const warn = levels.filter((level) => level === "warn").length;
  const failed = ports.length - present.length;
  return [
    `${modules} 个光模块，接在 ${present.length} 个口上`,
    bad ? `${bad} 条 lane 超出告警门限` : "没有超出告警门限的 lane",
    warn ? `${warn} 条离下限不到 2 dB` : "",
    failed ? `${failed} 个口读不到` : "",
  ]
    .filter(Boolean)
    .join("，");
}

/** 光模块的型号、序列号和收发光。收发光要手动点查询，读数留最近一次。 */
/** row.id 是资产 id。 */
export function ServerOptics({ row }: { row: { id: string; sn: string } }) {
  const [reading, setReading] = useState<OpticsReading | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const { apply, onColumnWidthChange } = useGridColumnWidths("pxe-optics-columns");
  const columns = useMemo(() => apply(COLUMNS), [apply]);
  const url = `/api/assets/${row.id}/optics`;

  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((response) => response.json())
      .then((body) => {
        if (!alive) return;
        setReading(body && !body.error ? (body as OpticsReading) : null);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [url]);

  async function query() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error || "查询失败");
      else setReading(body as OpticsReading);
    } catch {
      setError("没有连上控制台");
    } finally {
      setPending(false);
    }
  }

  const rows = useMemo<Row[]>(
    () =>
      reading
        ? [
            ...groupModules(reading.ports).map((group) => ({ id: `m-${group.info.pci}-${group.info.port}`, module: group })),
            ...reading.ports.filter((port) => !port.present).map((port) => ({ id: `p-${port.pci}-${port.port}`, port })),
          ]
        : [],
    [reading],
  );

  return (
    <Stack component="section" spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "flex-start" }}>
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h3">光模块</Typography>
          <Typography variant="caption" color="text.secondary">
            SSH 进系统读：NVIDIA/Mellanox 网卡用 mlxlink，其他网卡用 ethtool -m。一个模块一行，按序列号合并：twin-port 模块接两个口，收发光按口分行。颜色按模块自己报的告警门限：红色超出门限，黄色离下限不到 2 dB。型号和序列号也会在「采集硬件配置」时记进硬件明细。
          </Typography>
        </Stack>
        <Button type="button" variant="contained" disabled={pending} onClick={query}>
          {pending ? "正在查询" : "查询收发光"}
        </Button>
      </Stack>
      {pending ? (
        <Typography variant="body2" color="text.secondary">
          正在 SSH 进 {row.sn} 读每个口的模块，二十来个口要十几秒。
        </Typography>
      ) : null}
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {loaded && !reading && !pending ? (
        <Typography variant="body2" color="text.secondary">
          还没查询过。点「查询收发光」。
        </Typography>
      ) : null}

      {reading ? (
        <>
          <Typography variant="body2">
            {formatTime(reading.at)} 从{" "}
            <Box component="span" sx={{ fontFamily: MONO }}>
              {reading.host}
            </Box>{" "}
            读到：{reading.ports.length ? summary(reading.ports) : "没有发现光模块"}。
          </Typography>
          {reading.ports.length ? (
            <DataGrid
              rows={rows}
              columns={columns}
              onColumnWidthChange={onColumnWidthChange}
              autoHeight
              hideFooter
              disableColumnMenu
              disableColumnSorting
              getRowHeight={() => "auto"}
              sx={{ fontSize: 12, "& .MuiDataGrid-cell": { py: 0.75, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.5 } }}
            />
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
