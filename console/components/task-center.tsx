"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import ChecklistOutlined from "@mui/icons-material/ChecklistOutlined";
import { formatBytes, percent, useUploads, type LiveUpload } from "@/components/upload-provider";
import type { ImportJob } from "@/lib/import-jobs";
import type { TaskFeed, TaskSummary } from "@/lib/types";
import { formatTime } from "@/lib/time";

type FloatKind = "upload" | "batch";
type FloatPrefs = Record<FloatKind, boolean>;

const FLOAT_KEY = "pxe-upload-float";
const PREFS_KEY = "pxe-task-float-kinds";
// 小浮窗默认都关着，要的话在任务列表里勾上。
const DEFAULT_PREFS: FloatPrefs = { upload: false, batch: false };
const EMPTY: TaskFeed = { tasks: [], extracting: [], uploads: [] };

function loadPrefs(): FloatPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

function Bar({ value, active }: { value: number; active: boolean }) {
  return <LinearProgress variant="determinate" value={value} color={active ? "primary" : "inherit"} sx={{ height: 6, borderRadius: 3, color: active ? undefined : "text.disabled" }} />;
}

function Row({ title, state, error, titleHint }: { title: string; state: string; error?: boolean; titleHint?: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Typography noWrap title={titleHint || title} sx={{ flex: 1, minWidth: 0, fontWeight: 500, fontSize: 14 }}>
        {title}
      </Typography>
      <Typography variant="caption" sx={{ flexShrink: 0, color: error ? "error.main" : "text.secondary" }}>
        {state}
      </Typography>
    </Stack>
  );
}

function UploadItem({ item }: { item: LiveUpload }) {
  const uploads = useUploads();
  return (
    <Stack spacing={0.5}>
      <Row
        title={item.name || item.filename}
        titleHint={item.filename}
        error={item.state === "error"}
        state={item.state === "running" ? `${percent(item.offset, item.size)}%` : item.state === "done" ? "已传完" : item.state === "error" ? "已中断" : "已暂停"}
      />
      <Bar value={percent(item.offset, item.size)} active={item.state === "running" || item.state === "done"} />
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {item.state === "done" ? "后台正在识别和抽取" : `${formatBytes(item.offset)} / ${formatBytes(item.size)}`}
      </Typography>
      {item.error ? (
        <Typography variant="caption" sx={{ color: "error.main" }}>
          {item.error}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
        {item.state === "running" ? (
          <Button variant="outlined" color="inherit" onClick={uploads.pause}>
            暂停
          </Button>
        ) : item.state !== "done" && uploads.hasFile(item.id) ? (
          <Button variant="outlined" color="inherit" disabled={uploads.running} onClick={() => uploads.resume(item.id)}>
            继续
          </Button>
        ) : item.state !== "done" ? (
          <MuiLink component={Link} href="/images" variant="caption" color="text.secondary" sx={{ alignSelf: "center", px: 1 }}>
            到镜像页选文件继续
          </MuiLink>
        ) : null}
        {item.state === "done" ? (
          <Button color="inherit" onClick={() => uploads.dismiss(item.id)}>
            关闭
          </Button>
        ) : (
          <Button
            color="inherit"
            onClick={async () => {
              if (!window.confirm(`取消上传 ${item.name || item.filename}？已经传上去的部分会删除。`)) return;
              const failed = await uploads.cancel(item);
              if (failed) window.alert(failed);
            }}
          >
            取消
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

function BatchItem({ task, onDismiss }: { task: TaskSummary; onDismiss?: () => void }) {
  const finished = task.ok + task.failed;
  const value = task.total ? Math.floor((finished / task.total) * 100) : 100;
  const state = task.status === "running" ? `${finished} / ${task.total}` : task.failed ? `${task.failed} 台没成功` : "全部成功";
  return (
    <Stack spacing={0.5}>
      <Row title={task.name} state={state} error={task.status === "done" && task.failed > 0} />
      <Bar value={value} active={task.status === "running" || !task.failed} />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, color: "text.secondary" }}>
          {task.projectName || "资产"} · 成功 {task.ok}
          {task.failed ? ` · 失败 ${task.failed}` : ""} · {formatTime(task.createdAt)}
        </Typography>
        <MuiLink component={Link} href={`/tasks/${task.id}`} variant="caption" underline="hover">
          查看
        </MuiLink>
        {onDismiss ? (
          <MuiLink component="button" type="button" variant="caption" underline="hover" color="text.secondary" onClick={onDismiss}>
            关闭
          </MuiLink>
        ) : null}
      </Stack>
    </Stack>
  );
}

/** 后台的表格导入：在跑的显示进度，预览好了的等你点开确认。点「打开」回到导入页面接着看。 */
function ImportItem({ job, onRemove, onOpen }: { job: ImportJob; onRemove: () => void; onOpen: () => void }) {
  const summary = job.result as { created?: number; updated?: number; errors?: number } | null;
  const counts = summary ? `新建 ${summary.created ?? 0}，更新 ${summary.updated ?? 0}${summary.errors ? `，${summary.errors} 行有问题` : ""}` : "";
  const state =
    job.status === "running" ? (job.phase === "commit" ? "正在写入" : "准备中") : job.status === "ready" ? "预览好了，等确认" : job.status === "done" ? "已导入" : "出错了";
  const value = job.status === "running" && job.progress.total > 1 ? Math.floor((job.progress.done / job.progress.total) * 100) : 100;
  return (
    <Stack spacing={0.5}>
      <Row title={job.title} state={state} error={job.status === "error"} />
      {job.status === "running" ? (
        job.progress.total > 1 ? <Bar value={value} active /> : <LinearProgress sx={{ height: 6, borderRadius: 3 }} />
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, color: job.status === "error" ? "error.main" : "text.secondary" }}>
          {job.status === "running" ? job.progress.label : job.status === "error" ? job.error : `${job.status === "ready" ? "预览：" : ""}${counts}`} · {formatTime(job.startedAt)}
        </Typography>
        <MuiLink component={Link} href={`${job.page}?import=${encodeURIComponent(job.id)}`} onClick={onOpen} variant="caption" underline="hover">
          {job.status === "ready" ? "确认" : "打开"}
        </MuiLink>
        {job.status !== "running" ? (
          <Tooltip title="从列表里去掉">
            <IconButton size="small" aria-label="去掉" onClick={onRemove} sx={{ p: 0.25 }}>
              <CloseOutlined sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
    </Stack>
  );
}

function Section({ title, float, onFloat, children }: { title: string; float?: boolean; onFloat?: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <Stack spacing={1.5} component="section">
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle2" sx={{ color: "text.secondary" }}>
          {title}
        </Typography>
        {onFloat ? (
          <FormControlLabel
            control={<Checkbox checked={Boolean(float)} onChange={(event) => onFloat(event.target.checked)} sx={{ p: 0.5 }} />}
            label="小浮窗"
            slotProps={{ typography: { variant: "caption", color: "text.secondary" } }}
            sx={{ mr: 0 }}
          />
        ) : null}
      </Stack>
      {children}
    </Stack>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" sx={{ color: "text.secondary" }}>
      {children}
    </Typography>
  );
}

/** 右上角的任务列表：镜像上传、表格导入和批量任务的进度都在这里，上传和批量任务可以单独开小浮窗。 */
export function TaskCenter() {
  const pathname = usePathname();
  const uploads = useUploads();
  const [feed, setFeed] = useState<TaskFeed>(EMPTY);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<FloatPrefs>(DEFAULT_PREFS);
  // 小浮窗只跟这次打开页面以后跑过的批量任务，免得旧任务一上来就弹出来。
  const [followed, setFollowed] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const anchor = useRef<HTMLButtonElement>(null);

  const live = Object.values(uploads.live);
  const liveIds = new Set(live.map((item) => item.id));
  // 服务器上没传完、这个页面里也没有文件的，只能回镜像页重新选文件续传。
  const stale: LiveUpload[] = feed.uploads.filter((item) => !liveIds.has(item.id)).map((item) => ({ ...item, state: "paused" }));
  const panelUploads = [...live.filter((item) => item.state !== "done"), ...stale];
  const runningBatch = feed.tasks.filter((task) => task.status === "running");
  // 等确认的导入也算，提醒你回去点确认。
  const pendingImports = imports.filter((job) => job.status === "running" || job.status === "ready").length;
  const busy = live.filter((item) => item.state === "running").length + runningBatch.length + feed.extracting.length + pendingImports;
  const doneCount = live.filter((item) => item.state === "done").length;

  const load = useCallback(async () => {
    try {
      const [tasks, importJobs] = await Promise.all([fetch("/api/tasks", { cache: "no-store" }), fetch("/api/import-jobs", { cache: "no-store" })]);
      if (tasks.ok) setFeed(await tasks.json());
      if (importJobs.ok) setImports(await importJobs.json());
    } catch {
      // 断网时保留上次的列表，下一轮再取。
    }
  }, []);

  // 导入窗口开了后台任务或最小化时马上刷新。
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("pxe:import-jobs", refresh);
    return () => window.removeEventListener("pxe:import-jobs", refresh);
  }, [load]);

  async function removeImport(id: string) {
    await fetch(`/api/import-jobs/${id}`, { method: "DELETE" }).catch(() => null);
    await load();
  }

  useEffect(() => setPrefs(loadPrefs()), []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, open || busy ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [load, open, busy]);

  // 上传刚传完时马上取一次，好接上“正在抽取”。
  useEffect(() => {
    if (doneCount) void load();
  }, [doneCount, load]);

  const runningIds = runningBatch.map((task) => task.id).join(",");
  useEffect(() => {
    if (!runningIds) return;
    setFollowed((current) => [...new Set([...current, ...runningIds.split(",")])]);
  }, [runningIds]);

  useEffect(() => setOpen(false), [pathname]);

  function setFloat(kind: FloatKind, on: boolean) {
    const next = { ...prefs, [kind]: on };
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // 存不了就只在这次页面里生效。
    }
  }

  const floatUploads = prefs.upload && !pathname.startsWith("/images") ? live : [];
  const floatBatch = prefs.batch
    ? feed.tasks.filter((task) => followed.includes(task.id) && !dismissed.includes(task.id) && pathname !== `/tasks/${task.id}`)
    : [];

  return (
    <>
      <Button ref={anchor} variant="outlined" color="inherit" onClick={() => setOpen((value) => !value)} aria-expanded={open} startIcon={<ChecklistOutlined />} sx={{ borderColor: "divider" }}>
        任务
        {busy ? <Badge color="primary" badgeContent={busy} sx={{ ml: 1.75, mr: 0.5 }} /> : null}
      </Button>
      <Popover
        open={open}
        anchorEl={anchor.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { variant: "outlined", sx: { mt: 1, width: "min(24rem, calc(100vw - 2rem))", maxHeight: "75vh", p: 2, boxShadow: 6 } } }}
      >
        <Stack spacing={2.5}>
          <Section title="镜像上传" float={prefs.upload} onFloat={(on) => setFloat("upload", on)}>
            {panelUploads.map((item) => (
              <UploadItem key={item.id} item={item} />
            ))}
            {feed.extracting.map((image) => (
              <Stack key={image.id} spacing={0.5}>
                <Row title={image.name} state="识别和抽取中" />
                <LinearProgress sx={{ height: 6, borderRadius: 3 }} />
              </Stack>
            ))}
            {!panelUploads.length && !feed.extracting.length ? <Empty>没有进行中的上传。</Empty> : null}
          </Section>
          {imports.length ? (
            <Section title="表格导入">
              {imports.map((job) => (
                <ImportItem key={job.id} job={job} onRemove={() => void removeImport(job.id)} onOpen={() => setOpen(false)} />
              ))}
            </Section>
          ) : null}
          <Section title="批量任务" float={prefs.batch} onFloat={(on) => setFloat("batch", on)}>
            {feed.tasks.map((task) => (
              <BatchItem key={task.id} task={task} />
            ))}
            {!feed.tasks.length ? <Empty>还没有执行过批量任务。</Empty> : null}
          </Section>
        </Stack>
      </Popover>
      <TaskFloat
        uploads={floatUploads}
        batch={floatBatch}
        onHide={setFloat}
        onDismissBatch={(id) => setDismissed((current) => [...current, id])}
      />
    </>
  );
}

/** 能拖动的小浮窗，只显示在任务列表里勾了“小浮窗”的那几类。 */
function TaskFloat({
  uploads,
  batch,
  onHide,
  onDismissBatch,
}: {
  uploads: LiveUpload[];
  batch: TaskSummary[];
  onHide: (kind: FloatKind, on: boolean) => void;
  onDismissBatch: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const visible = uploads.length > 0 || batch.length > 0;

  const clamp = useCallback((x: number, y: number) => {
    const width = box.current?.offsetWidth || 288;
    const height = box.current?.offsetHeight || 120;
    return {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let saved: { x: number; y: number } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(FLOAT_KEY) || "null");
    } catch {
      saved = null;
    }
    const width = box.current?.offsetWidth || 288;
    const height = box.current?.offsetHeight || 120;
    setPos(clamp(saved?.x ?? window.innerWidth - width - 16, saved?.y ?? window.innerHeight - height - 16));
    const onResize = () => setPos((current) => (current ? clamp(current.x, current.y) : current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [visible, clamp]);

  if (!visible) return null;

  const heading = (title: string, kind: FloatKind, link?: { href: string; label: string }) => (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Typography variant="caption" sx={{ flex: 1, fontWeight: 500, color: "text.secondary" }}>
        {title}
      </Typography>
      {link ? (
        <MuiLink component={Link} href={link.href} variant="caption" color="text.secondary" underline="hover">
          {link.label}
        </MuiLink>
      ) : null}
      <Tooltip title="关掉这类的小浮窗，可以在右上角任务列表里重新打开">
        <IconButton onClick={() => onHide(kind, false)} sx={{ p: 0.25 }}>
          <CloseOutlined sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );

  return (
    <Paper
      ref={box}
      variant="outlined"
      sx={{ position: "fixed", zIndex: 1300, width: 288, maxHeight: "70vh", overflowY: "auto", boxShadow: 6, borderRadius: 3 }}
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }}
    >
      <Box
        sx={{ cursor: "move", touchAction: "none", userSelect: "none", px: 1.5, py: 0.75, bgcolor: "action.hover", fontSize: 12, fontWeight: 500 }}
        onPointerDown={(event) => {
          const rect = box.current!.getBoundingClientRect();
          drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPos(clamp(event.clientX - drag.current.dx, event.clientY - drag.current.dy));
        }}
        onPointerUp={() => {
          drag.current = null;
          try {
            if (pos) localStorage.setItem(FLOAT_KEY, JSON.stringify(pos));
          } catch {
            // 存不了位置也照样能用，只是下次回到默认位置。
          }
        }}
      >
        任务
      </Box>
      <Stack spacing={1.5} sx={{ p: 1.5 }}>
        {uploads.length ? (
          <Stack spacing={1}>
            {heading("镜像上传", "upload", { href: "/images", label: "打开镜像页" })}
            {uploads.map((item) => (
              <UploadItem key={item.id} item={item} />
            ))}
          </Stack>
        ) : null}
        {batch.length ? (
          <Stack spacing={1}>
            {heading("批量任务", "batch")}
            {batch.map((task) => (
              <BatchItem key={task.id} task={task} onDismiss={task.status === "done" ? () => onDismissBatch(task.id) : undefined} />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
