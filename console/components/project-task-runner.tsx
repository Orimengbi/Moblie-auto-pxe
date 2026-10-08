"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RemoteFile, RemoteTask, TaskHostSource, TaskTargetStatus } from "@/lib/types";

export const TARGET: Record<TaskTargetStatus, string> = {
  pending: "排队",
  running: "执行中",
  ok: "成功",
  failed: "失败",
  timeout: "超时",
  unreachable: "连不上",
};

export const HOST_SOURCE: Record<TaskHostSource, string> = {
  sheet: "系统地址",
  nic: "网卡规划",
  fixed: "固定 IP",
  lease: "DHCP 租约",
  "": "",
};

const TEMPLATES: { label: string; body: string }[] = [
  {
    label: "查看系统信息",
    body: 'hostname\ncat /etc/os-release | head -n 2\nuname -r\nip -br addr\nlsblk -d -o NAME,SIZE,MODEL\n',
  },
  {
    label: "安装上传的 deb / rpm 包",
    body: [
      "set -e",
      'ls "$PXE_FILES"',
      "if command -v apt-get >/dev/null 2>&1; then",
      "  apt-get install -y ./*.deb",
      "elif command -v dnf >/dev/null 2>&1; then",
      "  dnf install -y ./*.rpm",
      "else",
      "  yum install -y ./*.rpm",
      "fi",
      "",
    ].join("\n"),
  },
  {
    label: "执行上传的 .run 驱动",
    body: [
      "set -e",
      "for f in ./*.run; do",
      '  echo "安装 $f"',
      '  sh "$f" --silent',
      "done",
      "",
    ].join("\n"),
  },
];

function counts(task: RemoteTask): string {
  const by = (status: TaskTargetStatus) => task.targets.filter((target) => target.status === status).length;
  const parts = [`成功 ${by("ok")}`];
  for (const status of ["failed", "timeout", "unreachable", "running", "pending"] as const) {
    if (by(status)) parts.push(`${TARGET[status]} ${by(status)}`);
  }
  return `${parts.join(" · ")} / 共 ${task.targets.length} 台`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 机器在服务器列表里勾选，这里只管脚本、文件和执行结果。 */
export function ProjectTaskRunner({
  projectId,
  toAssets = (ids) => ids,
  picked,
  installed,
  onPick,
  files,
  tasks,
}: {
  /** 从装机批次页发起时带上，任务记在这个批次下。 */
  projectId?: string;
  /** 勾选的是装机行时换成资产 id；资产页勾的本来就是资产 id。 */
  toAssets?: (ids: string[]) => string[];
  picked: string[];
  installed: string[];
  /** 批次里所有机器。采集硬件没勾选时对全部机器做。 */
  onPick: (ids: string[]) => void;
  files: RemoteFile[];
  tasks: RemoteTask[];
}) {
  const router = useRouter();
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [concurrency, setConcurrency] = useState("10");
  const [timeoutSec, setTimeoutSec] = useState("600");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState("");
  // 0 表示收起，只看最近 3 条；展开后按页看，一页 10 条。
  const [taskPage, setTaskPage] = useState(0);
  const running = tasks.some((task) => task.status === "running");
  const taskPages = Math.max(1, Math.ceil(tasks.length / 10));
  const page = Math.min(taskPage, taskPages);
  // 收起时执行中的任务也始终显示。
  const shownTasks = page ? tasks.slice((page - 1) * 10, page * 10) : tasks.filter((task, index) => index < 3 || task.status === "running");

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  }

  async function submit(body: Record<string, unknown>) {
    setPending(true);
    setError("");
    const { serverIds, ...rest } = body as { serverIds: string[] };
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...rest, assetIds: toAssets(serverIds), ...(projectId ? { projectId } : {}) }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(result.error || "任务没有创建成功");
      return false;
    }
    router.refresh();
    return true;
  }

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit({ kind: "script", name, script, serverIds: picked, fileIds, concurrency, timeoutSec });
  }

  async function revoke() {
    const ids = picked.length ? picked : installed;
    if (!ids.length) {
      setError("没有已安装的机器");
      return;
    }
    if (!window.confirm(`从 ${ids.length} 台机器上撤掉控制台公钥？撤完以后控制台不能再登录这些机器执行脚本。`)) return;
    await submit({ kind: "revoke", serverIds: ids, concurrency, timeoutSec: 60 });
  }


  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(file.name);
    setError("");
    const response = await fetch(`/api/files?name=${encodeURIComponent(file.name)}`, { method: "PUT", body: file });
    const result = await response.json().catch(() => ({}));
    setUploading("");
    if (!response.ok) {
      setError(result.error || "上传失败");
      return;
    }
    setFileIds((list) => [...list, result.id]);
    router.refresh();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/files/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setError(result.error || "删除失败");
      return;
    }
    setFileIds((list) => list.filter((item) => item !== id));
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={run} className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          在上面的列表里勾选机器，用 SSH 以 root 执行同一段脚本。装机时已经把小主机的公钥写给 root。上传的文件先推到目标机，脚本里用 <code>$PXE_FILES</code> 访问，执行完就删掉。
        </p>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label>文件</Label>
            <span className="text-xs text-muted-foreground">驱动包、rpm、deb、压缩包都可以，勾上的会推到每台机器。</span>
          </div>
          {files.length ? (
            <div className="grid gap-1">
              {files.map((file) => (
                <div key={file.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={fileIds.includes(file.id)} onChange={() => setFileIds((list) => toggle(list, file.id))} />
                  <span className="font-mono text-xs">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
                  <Button type="button" size="xs" variant="ghost" onClick={() => remove(file.id)}>
                    删除
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <Input type="file" onChange={upload} disabled={Boolean(uploading)} className="w-fit" />
          {uploading ? <p className="text-xs text-muted-foreground">正在上传 {uploading}，大文件要等一会</p> : null}
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="task-script">脚本</Label>
            {TEMPLATES.map((item) => (
              <Button key={item.label} type="button" size="xs" variant="outline" onClick={() => setScript(item.body)}>
                {item.label}
              </Button>
            ))}
          </div>
          <Textarea id="task-script" className="min-h-40 font-mono text-xs" value={script} onChange={(event) => setScript(event.target.value)} placeholder="以 root 身份用 bash 执行，当前目录就是 $PXE_FILES" required />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="task-name">任务名称</Label>
            <Input id="task-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="不填就用脚本第一行" className="w-56" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="task-concurrency">同时执行</Label>
            <Input id="task-concurrency" type="number" min={1} max={50} value={concurrency} onChange={(event) => setConcurrency(event.target.value)} className="w-24" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="task-timeout">单台超时（秒）</Label>
            <Input id="task-timeout" type="number" min={10} max={7200} value={timeoutSec} onChange={(event) => setTimeoutSec(event.target.value)} className="w-28" />
          </div>
          <Button type="submit" disabled={pending || !picked.length}>
            {pending ? "正在创建" : picked.length ? `对选中的 ${picked.length} 台执行` : "先在列表里勾选机器"}
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>


      <div className="grid gap-2 rounded-lg border p-3">
        <p className="text-sm font-medium">交付清理</p>
        <p className="text-sm text-muted-foreground">交付前从机器上撤掉小主机的公钥。上面选了机器就只撤选中的，没选就撤全部已安装的机器。撤完后这些机器不能再从这里管理。</p>
        <Button type="button" variant="destructive" className="w-fit" disabled={pending} onClick={revoke}>
          撤掉控制台公钥
        </Button>
      </div>

      <div className="grid gap-3">
        <p className="text-sm font-medium">最近的任务</p>
        {tasks.length === 0 ? <p className="text-sm text-muted-foreground">还没有执行过任务。</p> : null}
        {shownTasks.map((task) => (
          <details key={task.id} className="rounded-lg border p-3" open={task.status === "running"}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <Badge variant={task.status === "running" ? "outline" : task.targets.every((target) => target.status === "ok") ? "default" : "destructive"}>
                {task.status === "running" ? "执行中" : "已结束"}
              </Badge>
              <span className="font-medium">{task.name}</span>
              <span className="text-xs text-muted-foreground">{counts(task)}</span>
              <span className="text-xs text-muted-foreground">{new Date(task.createdAt).toLocaleString("zh-CN")}</span>
              <Link href={`/tasks/${task.id}`} className="text-xs underline underline-offset-4">
                详情
              </Link>
              {task.status === "done" ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.preventDefault();
                    if (task.kind === "script") {
                      setScript(task.script);
                      setName(task.name);
                      setFileIds(task.fileIds.filter((id) => files.some((file) => file.id === id)));
                    }
                    onPick(task.targets.filter((target) => target.status !== "ok").map((target) => target.serverId));
                  }}
                >
                  选中没成功的机器
                </Button>
              ) : null}
            </summary>
            <div className="mt-3 grid gap-2">
              {task.targets.map((target) => (
                <details key={target.serverId} className="rounded-md border px-2 py-1">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <Badge variant={target.status === "ok" ? "default" : target.status === "running" || target.status === "pending" ? "outline" : "destructive"}>{TARGET[target.status]}</Badge>
                    <span className="font-mono text-xs">{target.sn}</span>
                    <span className="text-xs text-muted-foreground">
                      {target.host || "无地址"}
                      {target.hostSource ? `（${HOST_SOURCE[target.hostSource]}）` : ""}
                      {target.exitCode !== null ? ` · 退出码 ${target.exitCode}` : ""}
                    </span>
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{target.output || "（没有输出）"}</pre>
                </details>
              ))}
            </div>
          </details>
        ))}
        {page ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setTaskPage(page - 1)}>
              上一页
            </Button>
            <span className="text-muted-foreground">
              第 {page} / {taskPages} 页，共 {tasks.length} 条
            </span>
            <Button type="button" variant="outline" size="sm" disabled={page >= taskPages} onClick={() => setTaskPage(page + 1)}>
              下一页
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setTaskPage(0)}>
              收起
            </Button>
          </div>
        ) : tasks.length > shownTasks.length ? (
          <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setTaskPage(1)}>
            显示更多
          </Button>
        ) : null}
      </div>
    </div>
  );
}
