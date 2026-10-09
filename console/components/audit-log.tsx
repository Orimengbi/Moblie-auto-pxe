"use client";

import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef, type GridPaginationModel } from "@mui/x-data-grid";
import type { AuditEntry } from "@/lib/types";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";

const COLUMNS: GridColDef<AuditEntry>[] = [
  { field: "at", headerName: "时间", width: 160, renderCell: ({ row }) => <Box sx={{ fontSize: 12, whiteSpace: "nowrap" }}>{formatTime(row.at)}</Box> },
  { field: "actor", headerName: "用户", width: 110 },
  { field: "ip", headerName: "来源", width: 130, renderCell: ({ row }) => <Box sx={{ fontFamily: MONO, fontSize: 12 }}>{row.ip}</Box> },
  {
    field: "action",
    headerName: "动作",
    width: 160,
    renderCell: ({ row }) => (
      <Box sx={{ whiteSpace: "normal", color: row.ok ? undefined : "error.main" }}>
        {row.action}
        {row.ok ? "" : "（失败）"}
      </Box>
    ),
  },
  {
    field: "targetLabel",
    headerName: "对象",
    width: 200,
    renderCell: ({ row }) => (
      <Box sx={{ fontSize: 12, whiteSpace: "normal", wordBreak: "break-all" }}>
        {row.targetType === "asset" && row.targetId ? (
          <MuiLink href={`/assets?open=${row.targetId}`} color="inherit" underline="hover">
            {row.targetLabel || row.targetId}
          </MuiLink>
        ) : (
          row.targetLabel
        )}
      </Box>
    ),
  },
  {
    field: "detail",
    headerName: "详情",
    flex: 1,
    minWidth: 260,
    sortable: false,
    renderCell: ({ row }) => (
      <Box sx={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "text.secondary" }}>{row.detail.length > 300 ? `${row.detail.slice(0, 300)}…` : row.detail}</Box>
    ),
  },
];

/** 操作审计，新的在前，往下翻页。 */
export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState<GridPaginationModel>({ page: 0, pageSize: 100 });

  // 返回这次拿到几条，翻“更早的”时用来跳到新的那一页。
  const load = useCallback(async (keyword: string, before?: number): Promise<number> => {
    const params = new URLSearchParams({ limit: "100" });
    if (keyword) params.set("q", keyword);
    if (before) params.set("before", String(before));
    const response = await fetch(`/api/audit?${params}`).catch(() => null);
    const body = await response?.json().catch(() => []);
    if (!response?.ok) {
      setError(body?.error || "读取失败");
      return 0;
    }
    setError("");
    const list = body as AuditEntry[];
    setEntries((current) => (before ? [...current, ...list] : list));
    setMore(list.length === 100);
    return list.length;
  }, []);

  useEffect(() => {
    setPage((current) => ({ ...current, page: 0 }));
    void load(query);
  }, [load, query]);

  async function older() {
    const loaded = entries.length;
    if (await load(query, entries.at(-1)?.id)) setPage((current) => ({ ...current, page: Math.floor(loaded / current.pageSize) }));
  }

  return (
    <Stack spacing={2}>
      <Stack
        component="form"
        direction="row"
        useFlexGap
        spacing={1}
        sx={{ flexWrap: "wrap" }}
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          setQuery(q.trim());
        }}
      >
        <TextField placeholder="搜用户、动作、对象、地址…" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 288, maxWidth: "100%" }} />
        <Button type="submit" variant="outlined">
          搜索
        </Button>
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      <Box sx={{ width: "100%", minWidth: 0 }}>
        <DataGrid
          rows={entries}
          columns={COLUMNS}
          autoHeight
          getRowHeight={() => "auto"}
          paginationModel={page}
          onPaginationModelChange={setPage}
          pageSizeOptions={[25, 50, 100]}
          hideFooter={entries.length <= 100 && page.pageSize === 100}
          localeText={{ noRowsLabel: "没有记录。" }}
          sx={{ "& .MuiDataGrid-cell": { display: "flex", alignItems: "center", py: 0.75 } }}
        />
      </Box>
      {more ? (
        <Box>
          <Button variant="outlined" onClick={() => void older()}>
            更早的
          </Button>
        </Box>
      ) : null}
    </Stack>
  );
}
