"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import { StatusChip } from "@/components/mui/status-chip";
import { HOST_SOURCE, TARGET } from "@/components/project-task-runner";
import { taskTargetTone } from "@/lib/asset-labels";
import type { RemoteTask, TaskTargetStatus } from "@/lib/types";
import { formatTime } from "@/lib/time";

const KIND: Record<RemoteTask["kind"], string> = { script: "执行脚本", inventory: "采集硬件配置", revoke: "交付清理" };

const MONO = "var(--font-geist-mono), monospace";
const OUTPUT_SX = { m: 0, overflow: "auto", borderRadius: 1, bgcolor: "action.hover", p: 1, fontFamily: MONO, fontSize: 12, whiteSpace: "pre-wrap" } as const;

/** 一个批量任务的详情：每台机器的状态、地址、退出码和输出。执行中每 3 秒刷新。 */
export function TaskDetail({ initial, project, tags }: { initial: RemoteTask; project: { id: string; name: string } | null; tags: Record<string, string> }) {
  const [task, setTask] = useState(initial);
  const [open, setOpen] = useState<string[]>(() => (initial.targets.length === 1 ? [initial.targets[0].serverId] : []));
  const [filter, setFilter] = useState<"all" | "failed">("all");

  useEffect(() => {
    if (task.status !== "running") return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/tasks/${task.id}`).catch(() => null);
      if (response?.ok) setTask(await response.json());
    }, 3000);
    return () => clearInterval(timer);
  }, [task.id, task.status]);

  const by = (status: TaskTargetStatus) => task.targets.filter((target) => target.status === status).length;
  const failed = task.targets.filter((target) => !["ok", "pending", "running"].includes(target.status));
  const shown = filter === "failed" ? failed : task.targets;

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <StatusChip
          tone={task.status === "running" ? "info" : failed.length ? "error" : "success"}
          label={task.status === "running" ? "执行中" : failed.length ? `${failed.length} 台没成功` : "全部成功"}
        />
        <Typography variant="body2">{KIND[task.kind]}</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          共 {task.targets.length} 台，成功 {by("ok")}
          {by("running") ? `，执行中 ${by("running")}` : ""}
          {by("pending") ? `，排队 ${by("pending")}` : ""}
          {failed.length ? `，没成功 ${failed.length}` : ""}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {formatTime(task.createdAt)}
          {task.finishedAt ? ` → ${formatTime(task.finishedAt)}` : ""}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {project ? (
            <>
              装机批次{" "}
              <MuiLink component={Link} href={`/projects/${project.id}`}>
                {project.name}
              </MuiLink>
            </>
          ) : (
            "从资产发起"
          )}
          ，并发 {task.concurrency}，单台超时 {task.timeoutSec} 秒
        </Typography>
      </Stack>

      {task.kind === "script" ? (
        <Accordion variant="outlined" disableGutters sx={{ borderRadius: 2, "&::before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
            <Typography variant="subtitle2">脚本</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Box component="pre" sx={{ ...OUTPUT_SX, maxHeight: 320 }}>
              {task.script}
            </Box>
          </AccordionDetails>
        </Accordion>
      ) : null}

      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Button variant={filter === "all" ? "contained" : "outlined"} onClick={() => setFilter("all")}>
          全部（{task.targets.length}）
        </Button>
        <Button variant={filter === "failed" ? "contained" : "outlined"} disabled={!failed.length} onClick={() => setFilter("failed")}>
          没成功的（{failed.length}）
        </Button>
        <Button onClick={() => setOpen(open.length ? [] : shown.map((target) => target.serverId))}>{open.length ? "全部收起" : "全部展开"}</Button>
      </Stack>

      <Stack spacing={1}>
        {shown.map((target) => {
          const expanded = open.includes(target.serverId);
          return (
            <Paper key={target.serverId} variant="outlined">
              <ButtonBase
                onClick={() => setOpen(expanded ? open.filter((id) => id !== target.serverId) : [...open, target.serverId])}
                sx={{ width: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start", gap: 1, px: 1.5, py: 1, textAlign: "left", borderRadius: 1 }}
              >
                <StatusChip tone={taskTargetTone(target.status)} label={TARGET[target.status]} />
                <Typography component="span" variant="caption" sx={{ fontFamily: MONO }}>
                  {tags[target.serverId] ? `${tags[target.serverId]} · ` : ""}
                  {target.sn}
                </Typography>
                <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
                  {target.host || "无地址"}
                  {target.hostSource ? `（${HOST_SOURCE[target.hostSource]}）` : ""}
                  {target.exitCode !== null ? ` · 退出码 ${target.exitCode}` : ""}
                  {target.startedAt && target.finishedAt ? ` · ${Math.max(1, Math.round((Date.parse(target.finishedAt) - Date.parse(target.startedAt)) / 1000))} 秒` : ""}
                </Typography>
                <Typography component="span" variant="caption" sx={{ ml: "auto", color: "text.secondary" }}>
                  {expanded ? "收起" : "看输出"}
                </Typography>
              </ButtonBase>
              {expanded ? (
                <Stack spacing={1} sx={{ borderTop: 1, borderColor: "divider", px: 1.5, py: 1 }}>
                  <Box component="pre" sx={{ ...OUTPUT_SX, maxHeight: 512 }}>
                    {target.output || (target.status === "pending" ? "（还在排队）" : target.status === "running" ? "（执行中，结束后显示输出）" : "（没有输出）")}
                  </Box>
                  {tags[target.serverId] ? (
                    <MuiLink component={Link} href={`/assets?open=${target.serverId}`} variant="caption" sx={{ width: "fit-content" }}>
                      打开这台资产
                    </MuiLink>
                  ) : null}
                </Stack>
              ) : null}
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
