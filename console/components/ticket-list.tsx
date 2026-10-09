"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { StatusChip } from "@/components/mui/status-chip";
import { TicketCreateDialog } from "@/components/ticket-create-dialog";
import { OPEN_TICKET_STATUS, priorityTone, TICKET_KINDS, TICKET_PRIORITY, TICKET_STATUS, TICKET_STATUS_TONE } from "@/lib/asset-labels";
import type { Ticket } from "@/lib/types";
import { formatTime } from "@/lib/time";

export type TicketRow = Ticket & { assetTag: string; assetSn: string };

const MONO = "var(--font-geist-mono), monospace";
const NATIVE = { select: { native: true } } as const;

const COLUMNS: GridColDef<TicketRow>[] = [
  {
    field: "no",
    headerName: "编号",
    width: 130,
    renderCell: ({ row }) => (
      <MuiLink component={Link} href={`/tickets/${row.id}`} color="inherit" underline="hover" sx={{ fontFamily: MONO, fontSize: 12 }}>
        {row.no}
      </MuiLink>
    ),
  },
  { field: "title", headerName: "标题", flex: 1, minWidth: 220 },
  {
    field: "assetTag",
    headerName: "资产",
    width: 150,
    renderCell: ({ row }) => <Box sx={{ fontFamily: MONO, fontSize: 12 }}>{row.assetTag || "—"}</Box>,
  },
  { field: "kind", headerName: "类型", width: 90, valueGetter: (_value, row) => TICKET_KINDS[row.kind] },
  {
    field: "priority",
    headerName: "优先级",
    width: 90,
    valueGetter: (_value, row) => TICKET_PRIORITY[row.priority],
    renderCell: ({ row }) => <StatusChip tone={priorityTone(row.priority)} label={TICKET_PRIORITY[row.priority]} />,
  },
  {
    field: "status",
    headerName: "状态",
    width: 90,
    valueGetter: (_value, row) => TICKET_STATUS[row.status],
    renderCell: ({ row }) => <StatusChip tone={TICKET_STATUS_TONE[row.status]} label={TICKET_STATUS[row.status]} />,
  },
  {
    field: "assignee",
    headerName: "负责人",
    width: 110,
    renderCell: ({ row }) => row.assignee || <Box sx={{ color: "text.secondary" }}>未指派</Box>,
  },
  {
    field: "updatedAt",
    headerName: "更新",
    width: 160,
    renderCell: ({ row }) => <Box sx={{ fontSize: 12, color: "text.secondary" }}>{formatTime(row.updatedAt)}</Box>,
  },
];

/** 工单列表：默认只看没解决的，可以按状态、优先级、负责人筛。 */
export function TicketList({ tickets, me }: { tickets: TicketRow[]; me: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const wanted = search.get("status");
    if (wanted) setStatus(wanted);
  }, [search]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (status === "open" && !OPEN_TICKET_STATUS.includes(ticket.status)) return false;
      if (status && status !== "open" && status !== "all" && ticket.status !== status) return false;
      if (priority && ticket.priority !== priority) return false;
      if (mine && ticket.assignee !== me) return false;
      return !needle || [ticket.no, ticket.title, ticket.assetTag, ticket.assetSn, ticket.vendorCase, ticket.assignee].join(" ").toLowerCase().includes(needle);
    });
  }, [tickets, status, priority, mine, me, q]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField placeholder="搜编号、标题、资产、厂商单号…" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 224 }} />
        <TextField select slotProps={NATIVE} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="open">没解决的</option>
          <option value="all">全部</option>
          {Object.entries(TICKET_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}（{tickets.filter((ticket) => ticket.status === value).length}）
            </option>
          ))}
        </TextField>
        <TextField select slotProps={NATIVE} value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="">全部优先级</option>
          {Object.entries(TICKET_PRIORITY).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </TextField>
        <FormControlLabel control={<Checkbox checked={mine} onChange={(event) => setMine(event.target.checked)} />} label="只看我负责的" />
        <Button variant="contained" sx={{ ml: "auto" }} onClick={() => setCreating(true)}>
          新建工单
        </Button>
      </Stack>
      <Box sx={{ width: "100%", minWidth: 0 }}>
        <DataGrid
          rows={shown}
          columns={COLUMNS}
          autoHeight
          onRowClick={({ row }) => router.push(`/tickets/${row.id}`)}
          initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
          pageSizeOptions={[25, 50, 100]}
          hideFooter={shown.length <= 100}
          localeText={{ noRowsLabel: tickets.length ? "没有符合条件的工单。" : "还没有工单。" }}
          sx={{ "& .MuiDataGrid-row": { cursor: "pointer" } }}
        />
      </Box>
      <TicketCreateDialog open={creating} onClose={() => setCreating(false)} onCreated={(ticket) => router.push(`/tickets/${ticket.id}`)} />
    </Stack>
  );
}
