"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import UploadFileOutlined from "@mui/icons-material/UploadFileOutlined";
import { StatusChip } from "@/components/mui/status-chip";
import { taskTargetTone } from "@/lib/asset-labels";
import type { RemoteFile, RemoteTask, TaskHostSource, TaskTargetStatus } from "@/lib/types";
import { formatTime } from "@/lib/time";

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

const MONO = "var(--font-geist-mono), monospace";

/** 折叠块去掉 MUI 默认的分隔线，和上下的块之间留空。 */
const FOLD_SX = { borderRadius: 2, "&::before": { display: "none" } } as const;

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
    <Stack spacing={3}>
      <Stack component="form" onSubmit={run} spacing={2}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          在上面的列表里勾选机器，用 SSH 以 root 执行同一段脚本。装机时已经把小主机的公钥写给 root。上传的文件先推到目标机，脚本里用{" "}
          <Box component="code" sx={{ fontFamily: MONO }}>
            $PXE_FILES
          </Box>{" "}
          访问，执行完就删掉。
        </Typography>

        <Stack spacing={1}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <Typography variant="subtitle2">文件</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              驱动包、rpm、deb、压缩包都可以，勾上的会推到每台机器。
            </Typography>
          </Stack>
          {files.length ? (
            <Stack spacing={0.25}>
              {files.map((file) => (
                <Stack key={file.id} direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                  <Checkbox checked={fileIds.includes(file.id)} onChange={() => setFileIds((list) => toggle(list, file.id))} slotProps={{ input: { "aria-label": `推送 ${file.name}` } }} sx={{ p: 0.5 }} />
                  <Typography variant="caption" sx={{ fontFamily: MONO, minWidth: 0, wordBreak: "break-all" }}>
                    {file.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary", flexShrink: 0 }}>
                    {formatSize(file.size)}
                  </Typography>
                  <Button color="error" onClick={() => remove(file.id)} sx={{ flexShrink: 0 }}>
                    删除
                  </Button>
                </Stack>
              ))}
            </Stack>
          ) : null}
          <Box>
            <Button component="label" variant="outlined" startIcon={<UploadFileOutlined />} disabled={Boolean(uploading)}>
              上传文件
              <input type="file" hidden onChange={upload} disabled={Boolean(uploading)} />
            </Button>
          </Box>
          {uploading ? (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              正在上传 {uploading}，大文件要等一会
            </Typography>
          ) : null}
        </Stack>

        <Stack spacing={1}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <Typography variant="subtitle2" component="label" htmlFor="task-script">
              脚本
            </Typography>
            {TEMPLATES.map((item) => (
              <Button key={item.label} variant="outlined" onClick={() => setScript(item.body)}>
                {item.label}
              </Button>
            ))}
          </Stack>
          <TextField
            id="task-script"
            multiline
            minRows={8}
            value={script}
            onChange={(event) => setScript(event.target.value)}
            placeholder="以 root 身份用 bash 执行，当前目录就是 $PXE_FILES"
            required
            fullWidth
            slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 12 } } }}
          />
        </Stack>

        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <TextField id="task-name" label="任务名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="不填就用脚本第一行" sx={{ width: 224 }} />
          <TextField
            id="task-concurrency"
            label="同时执行"
            type="number"
            value={concurrency}
            onChange={(event) => setConcurrency(event.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 50 } }}
            sx={{ width: 96 }}
          />
          <TextField
            id="task-timeout"
            label="单台超时（秒）"
            type="number"
            value={timeoutSec}
            onChange={(event) => setTimeoutSec(event.target.value)}
            slotProps={{ htmlInput: { min: 10, max: 7200 } }}
            sx={{ width: 128 }}
          />
          <Button type="submit" variant="contained" disabled={pending || !picked.length}>
            {pending ? "正在创建" : picked.length ? `对选中的 ${picked.length} 台执行` : "先在列表里勾选机器"}
          </Button>
        </Stack>
        {error ? (
          <Typography variant="body2" sx={{ color: "error.main" }}>
            {error}
          </Typography>
        ) : null}
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
          <Typography variant="subtitle2">交付清理</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            交付前从机器上撤掉小主机的公钥。上面选了机器就只撤选中的，没选就撤全部已安装的机器。撤完后这些机器不能再从这里管理。
          </Typography>
          <Button variant="contained" color="error" disabled={pending} onClick={revoke}>
            撤掉控制台公钥
          </Button>
        </Stack>
      </Paper>

      <Stack spacing={1.5}>
        <Typography variant="subtitle2">最近的任务</Typography>
        {tasks.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            还没有执行过任务。
          </Typography>
        ) : null}
        {shownTasks.map((task) => (
          <Accordion key={task.id} variant="outlined" disableGutters defaultExpanded={task.status === "running"} slotProps={{ transition: { unmountOnExit: true } }} sx={FOLD_SX}>
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <StatusChip
                  tone={task.status === "running" ? "info" : task.targets.every((target) => target.status === "ok") ? "success" : "error"}
                  label={task.status === "running" ? "执行中" : "已结束"}
                />
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {task.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {counts(task)}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {formatTime(task.createdAt)}
                </Typography>
                <MuiLink component={Link} href={`/tasks/${task.id}`} variant="caption" onClick={(event) => event.stopPropagation()}>
                  详情
                </MuiLink>
                {task.status === "done" ? (
                  <Button
                    onClick={(event) => {
                      // 别顺带把折叠块展开或收起。
                      event.stopPropagation();
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
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                {task.targets.map((target) => (
                  <Accordion key={target.serverId} variant="outlined" disableGutters slotProps={{ transition: { unmountOnExit: true } }} sx={FOLD_SX}>
                    <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 40, "& .MuiAccordionSummary-content": { my: 0.75 } }}>
                      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                        <StatusChip tone={taskTargetTone(target.status)} label={TARGET[target.status]} />
                        <Typography variant="caption" sx={{ fontFamily: MONO }}>
                          {target.sn}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          {target.host || "无地址"}
                          {target.hostSource ? `（${HOST_SOURCE[target.hostSource]}）` : ""}
                          {target.exitCode !== null ? ` · 退出码 ${target.exitCode}` : ""}
                        </Typography>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0 }}>
                      <Box
                        component="pre"
                        sx={{ m: 0, maxHeight: 320, overflow: "auto", borderRadius: 1, bgcolor: "action.hover", p: 1, fontFamily: MONO, fontSize: 12, whiteSpace: "pre-wrap" }}
                      >
                        {target.output || "（没有输出）"}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
        {page ? (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="outlined" disabled={page <= 1} onClick={() => setTaskPage(page - 1)}>
              上一页
            </Button>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              第 {page} / {taskPages} 页，共 {tasks.length} 条
            </Typography>
            <Button variant="outlined" disabled={page >= taskPages} onClick={() => setTaskPage(page + 1)}>
              下一页
            </Button>
            <Button onClick={() => setTaskPage(0)}>收起</Button>
          </Stack>
        ) : tasks.length > shownTasks.length ? (
          <Box>
            <Button onClick={() => setTaskPage(1)}>显示更多</Button>
          </Box>
        ) : null}
      </Stack>
    </Stack>
  );
}
