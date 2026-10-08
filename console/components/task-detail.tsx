"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HOST_SOURCE, TARGET } from "@/components/project-task-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RemoteTask, TaskTargetStatus } from "@/lib/types";

const KIND: Record<RemoteTask["kind"], string> = { script: "执行脚本", inventory: "采集硬件配置", revoke: "交付清理" };

function variant(status: TaskTargetStatus): "default" | "outline" | "destructive" {
  return status === "ok" ? "default" : status === "running" || status === "pending" ? "outline" : "destructive";
}

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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={task.status === "running" ? "outline" : failed.length ? "destructive" : "default"}>{task.status === "running" ? "执行中" : failed.length ? `${failed.length} 台没成功` : "全部成功"}</Badge>
        <span>{KIND[task.kind]}</span>
        <span className="text-muted-foreground">
          共 {task.targets.length} 台，成功 {by("ok")}
          {by("running") ? `，执行中 ${by("running")}` : ""}
          {by("pending") ? `，排队 ${by("pending")}` : ""}
          {failed.length ? `，没成功 ${failed.length}` : ""}
        </span>
        <span className="text-muted-foreground">
          {new Date(task.createdAt).toLocaleString("zh-CN")}
          {task.finishedAt ? ` → ${new Date(task.finishedAt).toLocaleString("zh-CN")}` : ""}
        </span>
        <span className="text-muted-foreground">
          {project ? (
            <>
              装机批次{" "}
              <Link href={`/projects/${project.id}`} className="underline underline-offset-4">
                {project.name}
              </Link>
            </>
          ) : (
            "从资产发起"
          )}
          ，并发 {task.concurrency}，单台超时 {task.timeoutSec} 秒
        </span>
      </div>

      {task.kind === "script" ? (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">脚本</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{task.script}</pre>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
          全部（{task.targets.length}）
        </Button>
        <Button type="button" size="sm" variant={filter === "failed" ? "default" : "outline"} disabled={!failed.length} onClick={() => setFilter("failed")}>
          没成功的（{failed.length}）
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open.length ? [] : shown.map((target) => target.serverId))}>
          {open.length ? "全部收起" : "全部展开"}
        </Button>
      </div>

      <div className="grid gap-2">
        {shown.map((target) => {
          const expanded = open.includes(target.serverId);
          return (
            <div key={target.serverId} className="rounded-md border">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm"
                onClick={() => setOpen(expanded ? open.filter((id) => id !== target.serverId) : [...open, target.serverId])}
              >
                <Badge variant={variant(target.status)}>{TARGET[target.status]}</Badge>
                <span className="font-mono text-xs">{tags[target.serverId] ? `${tags[target.serverId]} · ` : ""}{target.sn}</span>
                <span className="text-xs text-muted-foreground">
                  {target.host || "无地址"}
                  {target.hostSource ? `（${HOST_SOURCE[target.hostSource]}）` : ""}
                  {target.exitCode !== null ? ` · 退出码 ${target.exitCode}` : ""}
                  {target.startedAt && target.finishedAt ? ` · ${Math.max(1, Math.round((Date.parse(target.finishedAt) - Date.parse(target.startedAt)) / 1000))} 秒` : ""}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{expanded ? "收起" : "看输出"}</span>
              </button>
              {expanded ? (
                <div className="grid gap-2 border-t px-3 py-2">
                  <pre className="max-h-[32rem] overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{target.output || (target.status === "pending" ? "（还在排队）" : target.status === "running" ? "（执行中，结束后显示输出）" : "（没有输出）")}</pre>
                  {tags[target.serverId] ? (
                    <Link href={`/assets?open=${target.serverId}`} className="w-fit text-xs underline underline-offset-4">
                      打开这台资产
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
