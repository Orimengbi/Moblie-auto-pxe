"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { StatusChip } from "@/components/mui/status-chip";
import { ALERT_SEVERITY, ALERT_SEVERITY_TONE, ALERT_SOURCE, ALERT_STATUS } from "@/lib/asset-labels";
import type { Alert } from "@/lib/types";
import { formatTime } from "@/lib/time";
import { api } from "@/lib/client-api";

export type AlertRow = Alert & { assetTag: string; assetSn: string };

const MONO = "var(--font-geist-mono), monospace";
const NATIVE = { select: { native: true } } as const;

export async function alertAction(id: number, action: "ack" | "resolve" | "ticket"): Promise<{ error: string; ticketId?: string }> {
  const result = await api<{ id?: string }>(`/api/alerts/${id}/${action}`, "POST");
  return { error: result.error, ticketId: result.ok && action === "ticket" ? result.data.id : undefined };
}

function when(at: string): string {
  return at ? formatTime(at, "short") : "";
}

/** 告警列表：默认只看没恢复的，严重的在前。每 30 秒刷新一次。 */
export function AlertBoard({ alerts, summary }: { alerts: AlertRow[]; summary: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("open");
  const [severity, setSeverity] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [router]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return alerts
      .filter((alert) => {
        if (status === "open" && alert.status === "resolved") return false;
        if (status === "resolved" && alert.status !== "resolved") return false;
        if (severity && alert.severity !== severity) return false;
        if (source && alert.source !== source) return false;
        return !needle || [alert.title, alert.detail, alert.assetTag, alert.assetSn].join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const rank = (alert: Alert) => (alert.status === "active" ? 0 : alert.status === "acked" ? 1 : 2) * 2 + (alert.severity === "critical" ? 0 : 1);
        return rank(a) - rank(b) || b.lastAt.localeCompare(a.lastAt);
      });
  }, [alerts, status, severity, source, q]);

  async function act(alert: AlertRow, action: "ack" | "resolve" | "ticket") {
    if (action === "resolve" && !window.confirm(alert.sticky ? "标成处理完？" : "手动标成已恢复？条件还在的话下次检查会再报。")) return;
    const result = await alertAction(alert.id, action);
    setError(result.error);
    if (result.ticketId) router.push(`/tickets/${result.ticketId}`);
    else router.refresh();
  }

  const columns: GridColDef<AlertRow>[] = [
    {
      field: "severity",
      headerName: "级别",
      width: 80,
      renderCell: ({ row }) => <StatusChip tone={ALERT_SEVERITY_TONE[row.severity]} label={ALERT_SEVERITY[row.severity]} />,
    },
    {
      field: "title",
      headerName: "告警",
      flex: 1,
      minWidth: 280,
      renderCell: ({ row }) => (
        <Box sx={{ whiteSpace: "normal", py: 0.75 }}>
          <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
            {row.title}
          </Typography>
          {row.count > 1 ? (
            <Typography component="span" variant="caption" sx={{ ml: 0.5, color: "text.secondary" }}>
              ×{row.count}
            </Typography>
          ) : null}
          <Typography variant="caption" sx={{ display: "block", wordBreak: "break-all", color: "text.secondary" }}>
            {row.detail}
          </Typography>
        </Box>
      ),
    },
    {
      field: "assetTag",
      headerName: "资产",
      width: 170,
      renderCell: ({ row }) => (
        <Box sx={{ fontFamily: MONO, fontSize: 12, py: 0.75 }}>
          <MuiLink component={Link} href={`/assets?open=${row.assetId}`} underline="hover" color="inherit">
            {row.assetTag}
          </MuiLink>
          <Box sx={{ color: "text.secondary" }}>{row.assetSn}</Box>
        </Box>
      ),
    },
    { field: "source", headerName: "来源", width: 100, valueGetter: (_value, row) => ALERT_SOURCE[row.source] },
    {
      field: "status",
      headerName: "状态",
      width: 110,
      valueGetter: (_value, row) => ALERT_STATUS[row.status],
      renderCell: ({ row }) => (
        <Box sx={{ fontSize: 12, py: 0.75 }}>
          {ALERT_STATUS[row.status]}
          {row.status === "acked" && row.ackedBy ? <Box sx={{ color: "text.secondary" }}>{row.ackedBy}</Box> : null}
          {row.status === "resolved" ? <Box sx={{ color: "text.secondary" }}>{row.resolvedBy}</Box> : null}
        </Box>
      ),
    },
    {
      field: "firstAt",
      headerName: "时间",
      width: 150,
      renderCell: ({ row }) => (
        <Box sx={{ fontSize: 12, whiteSpace: "nowrap", color: "text.secondary", py: 0.75 }}>
          {when(row.firstAt)}
          {row.lastAt !== row.firstAt ? <Box>最近 {when(row.lastAt)}</Box> : null}
          {row.resolvedAt ? <Box>恢复 {when(row.resolvedAt)}</Box> : null}
        </Box>
      ),
    },
    {
      field: "actions",
      headerName: "",
      width: 220,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ width: "100%", alignItems: "center", justifyContent: "flex-end" }}>
          {row.ticketId ? (
            <MuiLink component={Link} href={`/tickets/${row.ticketId}`} variant="caption" sx={{ mr: 1 }}>
              工单
            </MuiLink>
          ) : null}
          {row.status === "active" ? <Button onClick={() => void act(row, "ack")}>确认</Button> : null}
          {row.status !== "resolved" && !row.ticketId ? <Button onClick={() => void act(row, "ticket")}>转工单</Button> : null}
          {row.status !== "resolved" ? <Button onClick={() => void act(row, "resolve")}>处理完</Button> : null}
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {summary}
      </Typography>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField placeholder="搜标题、资产、详情…" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 224 }} />
        <TextField select slotProps={NATIVE} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="open">没恢复的</option>
          <option value="resolved">已恢复的</option>
          <option value="all">全部</option>
        </TextField>
        <TextField select slotProps={NATIVE} value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option value="">全部级别</option>
          {Object.entries(ALERT_SEVERITY).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </TextField>
        <TextField select slotProps={NATIVE} value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="">全部来源</option>
          {Object.entries(ALERT_SOURCE).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </TextField>
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      <Box sx={{ width: "100%", minWidth: 0 }}>
        <DataGrid
          rows={shown}
          columns={columns}
          autoHeight
          getRowHeight={() => "auto"}
          // 已恢复的变淡，一眼分出还要处理的
          getRowClassName={({ row }) => (row.status === "resolved" ? "alert-resolved" : "")}
          initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
          pageSizeOptions={[25, 50, 100]}
          hideFooter={shown.length <= 100}
          localeText={{ noRowsLabel: status === "open" ? "没有告警。" : "没有符合条件的告警。" }}
          sx={{ "& .alert-resolved": { opacity: 0.6 }, "& .MuiDataGrid-cell": { display: "flex", alignItems: "center" } }}
        />
      </Box>
    </Stack>
  );
}
