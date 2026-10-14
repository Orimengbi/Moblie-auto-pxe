"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type GridColDef, type GridPaginationModel, type GridRowSelectionModel } from "@mui/x-data-grid";
import { ScrollGrid } from "@/components/mui/scroll-grid";
import { StatusChip } from "@/components/mui/status-chip";
import { gridText } from "@/components/mui/theme";
import { TASK_KIND_LABEL } from "@/lib/asset-labels";
import { api } from "@/lib/client-api";
import { formatTime } from "@/lib/time";
import type { TaskKind, TaskSummary } from "@/lib/types";

type StatusFilter = "" | "running" | "failed" | "ok";
type ArchiveFilter = "" | "active" | "archived";

export function taskState(task: TaskSummary): { tone: "info" | "error" | "success"; label: string } {
  if (task.status === "running") return { tone: "info", label: "执行中" };
  return task.failed ? { tone: "error", label: `${task.failed} 台没成功` } : { tone: "success", label: "全部成功" };
}

const COLUMNS: GridColDef<TaskSummary>[] = [
  {
    field: "name",
    headerName: "任务",
    flex: 1,
    minWidth: 220,
    renderCell: ({ row }) => (
      <MuiLink component={Link} href={`/tasks/${row.id}`} underline="hover" sx={{ whiteSpace: "normal" }}>
        {row.name}
      </MuiLink>
    ),
  },
  { field: "kind", headerName: "类型", width: 120, valueGetter: (_, row) => TASK_KIND_LABEL[row.kind] },
  {
    field: "projectName",
    headerName: "来源",
    width: 150,
    renderCell: ({ row }) =>
      row.projectId ? (
        <MuiLink component={Link} href={`/projects/${row.projectId}`} color="inherit" underline="hover">
          {row.projectName}
        </MuiLink>
      ) : (
        <Box sx={{ color: "text.secondary" }}>资产</Box>
      ),
  },
  {
    field: "status",
    headerName: "状态",
    width: 210,
    valueGetter: (_, row) => taskState(row).label,
    renderCell: ({ row }) => {
      const state = taskState(row);
      const finished = row.ok + row.failed;
      return (
        <Stack spacing={0.5} sx={{ width: "100%" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <StatusChip tone={state.tone} label={state.label} />
            <Typography variant="caption" noWrap sx={{ color: "text.secondary" }}>
              {row.status === "running" && row.progress ? `${row.progress.label}${row.progress.percent !== null ? ` ${row.progress.percent}%` : ""}` : `${finished} / ${row.total}`}
            </Typography>
          </Stack>
          {row.status === "running" ? (
            row.progress ? (
              <LinearProgress variant={row.progress.percent === null ? "indeterminate" : "determinate"} value={row.progress.percent ?? undefined} sx={{ height: 4, borderRadius: 2 }} />
            ) : (
              <LinearProgress variant="determinate" value={row.total ? Math.floor((finished / row.total) * 100) : 0} sx={{ height: 4, borderRadius: 2 }} />
            )
          ) : null}
        </Stack>
      );
    },
  },
  {
    field: "total",
    headerName: "台数",
    width: 130,
    renderCell: ({ row }) => (
      <Box sx={{ fontSize: 12 }}>
        共 {row.total}，成功 {row.ok}
        {row.failed ? <Box component="span" sx={{ color: "error.main" }}>，失败 {row.failed}</Box> : null}
      </Box>
    ),
  },
  { field: "createdAt", headerName: "开始", width: 150, renderCell: ({ row }) => <Box sx={{ fontSize: 12 }}>{formatTime(row.createdAt)}</Box> },
  { field: "finishedAt", headerName: "结束", width: 150, renderCell: ({ row }) => <Box sx={{ fontSize: 12 }}>{row.finishedAt ? formatTime(row.finishedAt) : "—"}</Box> },
  {
    field: "archivedAt",
    headerName: "归档",
    width: 170,
    renderCell: ({ row }) => (
      <Box sx={{ fontSize: 12, color: "text.secondary" }}>
        {row.archivedAt ? `${formatTime(row.archivedAt)} · ${row.archivedBy || ""}` : row.status === "done" ? "未归档" : "—"}
      </Box>
    ),
  },
];

/** 任务中心：全部批量任务。勾选结束了的任务后可以归档或取消归档；归档只是不在右上角列表里显示。 */
export function TaskList() {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<TaskKind | "">("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [archive, setArchive] = useState<ArchiveFilter>("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<GridPaginationModel>({ page: 0, pageSize: 100 });

  const load = useCallback(async () => {
    const result = await api<{ tasks: TaskSummary[] }>("/api/tasks?view=all");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setTasks(result.data.tasks);
  }, []);

  const running = tasks?.some((task) => task.status === "running") || false;
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), running ? 5000 : 30_000);
    return () => window.clearInterval(timer);
  }, [load, running]);

  const shown = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return (tasks || []).filter(
      (task) =>
        (!kind || task.kind === kind) &&
        (!status || (status === "running" ? task.status === "running" : task.status === "done" && (status === "failed" ? task.failed > 0 : task.failed === 0))) &&
        (!archive || (archive === "archived") === Boolean(task.archivedAt)) &&
        (!keyword || `${task.name} ${task.projectName} ${TASK_KIND_LABEL[task.kind]}`.toLowerCase().includes(keyword)),
    );
  }, [tasks, q, kind, status, archive]);

  const selection = useMemo<GridRowSelectionModel>(() => ({ type: "include", ids: new Set(picked) }), [picked]);
  const chosen = (tasks || []).filter((task) => picked.includes(task.id));
  const canArchive = chosen.filter((task) => task.status === "done" && !task.archivedAt);
  const canRestore = chosen.filter((task) => task.archivedAt);

  async function setArchived(list: TaskSummary[], archived: boolean) {
    setBusy(true);
    const result = await api<{ changed: number }>("/api/tasks/archive", "POST", { ids: list.map((task) => task.id), archived });
    setBusy(false);
    if (!result.ok) setError(result.error);
    await load();
  }

  const counts = {
    running: tasks?.filter((task) => task.status === "running").length || 0,
    active: tasks?.filter((task) => !task.archivedAt).length || 0,
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField placeholder="搜任务名、批次…" value={q} onChange={(event) => setQ(event.target.value)} sx={{ width: 240, maxWidth: "100%" }} />
        <TextField select label="类型" value={kind} onChange={(event) => setKind(event.target.value as TaskKind | "")} sx={{ width: 150 }} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
          <option value="">全部</option>
          {Object.entries(TASK_KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </TextField>
        <TextField select label="状态" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} sx={{ width: 130 }} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
          <option value="">全部</option>
          <option value="running">执行中</option>
          <option value="failed">有没成功的</option>
          <option value="ok">全部成功</option>
        </TextField>
        <TextField select label="归档" value={archive} onChange={(event) => setArchive(event.target.value as ArchiveFilter)} sx={{ width: 130 }} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
          <option value="">全部</option>
          <option value="active">未归档</option>
          <option value="archived">已归档</option>
        </TextField>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          共 {tasks?.length ?? "…"} 个，执行中 {counts.running}，右上角显示 {counts.active} 个
        </Typography>
      </Stack>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", minHeight: 32 }}>
        <Typography variant="body2" sx={{ color: picked.length ? "text.primary" : "text.secondary" }}>
          {picked.length ? `已选 ${picked.length} 个` : "勾选任务后可以归档或取消归档。结束满 1 小时的会自动归档。"}
        </Typography>
        {picked.length ? (
          <>
            <Button variant="outlined" disabled={busy || !canArchive.length} onClick={() => void setArchived(canArchive, true)}>
              归档{canArchive.length && canArchive.length !== picked.length ? `（${canArchive.length} 个）` : ""}
            </Button>
            <Button variant="outlined" disabled={busy || !canRestore.length} onClick={() => void setArchived(canRestore, false)}>
              取消归档{canRestore.length && canRestore.length !== picked.length ? `（${canRestore.length} 个）` : ""}
            </Button>
            <Button onClick={() => setPicked([])}>清空选择</Button>
          </>
        ) : null}
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      <Box sx={{ width: "100%", minWidth: 0 }}>
        <ScrollGrid
          rows={shown}
          columns={COLUMNS}
          loading={tasks === null}
          getRowHeight={() => "auto"}
          checkboxSelection
          disableRowSelectionOnClick
          disableRowSelectionExcludeModel
          keepNonExistentRowsSelected
          rowSelectionModel={selection}
          onRowSelectionModelChange={(model) => setPicked([...model.ids].map(String))}
          paginationModel={page}
          onPaginationModelChange={setPage}
          pageSizeOptions={[25, 50, 100]}
          localeText={gridText({ noRowsLabel: tasks?.length ? "没有符合条件的任务。" : "还没有执行过批量任务。" })}
          sx={{ "& .MuiDataGrid-cell": { display: "flex", alignItems: "center", py: 0.75 } }}
        />
      </Box>
    </Stack>
  );
}
