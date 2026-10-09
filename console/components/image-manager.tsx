"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import UploadFileOutlined from "@mui/icons-material/UploadFileOutlined";
import { StatusChip } from "@/components/mui/status-chip";
import { formatBytes, fingerprintOf, percent, useUploads, type LiveUpload, type PendingUpload } from "@/components/upload-provider";
import { ISO_ACCEPT, ISO_FORMATS_LABEL } from "@/lib/iso-name";
import { FAMILY_LABEL, type ImageRecord } from "@/lib/types";
import { formatTime } from "@/lib/time";

export type { PendingUpload } from "@/components/upload-provider";

function without(map: Record<string, string>, key: string): Record<string, string> {
  const next = { ...map };
  delete next[key];
  return next;
}

export function ImageManager({ images, uploads }: { images: ImageRecord[]; uploads: PendingUpload[] }) {
  const router = useRouter();
  const live = useUploads();
  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [pickErrors, setPickErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const resumePicker = useRef<HTMLInputElement>(null);
  const [resumeTarget, setResumeTarget] = useState<PendingUpload | null>(null);
  const extracting = images.some((image) => image.status === "extracting");
  const resumable = file ? uploads.find((item) => item.fingerprint === fingerprintOf(file) && item.size === file.size) : undefined;
  // 服务器记着的没传完的会话，叠上这个页面里正在跑或刚断开的状态。
  const tasks: LiveUpload[] = [
    ...Object.values(live.live).filter((item) => item.state !== "done" && !uploads.some((upload) => upload.id === item.id)),
    ...uploads.map((item) => {
      const current = live.live[item.id];
      return current ? { ...item, ...current, offset: Math.max(item.offset, current.offset) } : { ...item, state: "paused" as const };
    }),
  ];
  const doneIds = Object.values(live.live).filter((item) => item.state === "done").map((item) => item.id).join(",");

  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [extracting, router]);

  // 传完的已经在下面的镜像表里了，不用再挂着。
  useEffect(() => {
    if (doneIds) doneIds.split(",").forEach((id) => live.dismiss(id));
  }, [doneIds, live]);

  function startSelected() {
    if (!file) return;
    const selected = file;
    setFile(null);
    setUploadName("");
    setPickerKey((key) => key + 1);
    setError("");
    live.run(selected, uploadName);
  }

  function resume(item: PendingUpload) {
    setPickErrors((current) => without(current, item.id));
    if (live.resume(item.id)) return;
    setResumeTarget(item);
    resumePicker.current?.click();
  }

  function resumeWith(picked: File | undefined) {
    const item = resumeTarget;
    setResumeTarget(null);
    if (!item || !picked) return;
    if (fingerprintOf(picked) !== item.fingerprint || picked.size !== item.size) {
      setPickErrors((current) => ({ ...current, [item.id]: `选的不是原来的文件，请选 ${item.fingerprint.split(":")[0]}（${formatBytes(item.size)}）` }));
      return;
    }
    live.run(picked, item.name);
  }

  async function cancel(item: PendingUpload) {
    if (!window.confirm(`取消上传 ${item.name || item.filename}？已经传上去的部分会删除。`)) return;
    const failed = await live.cancel(item);
    if (failed) setPickErrors((current) => ({ ...current, [item.id]: failed }));
  }

  async function remove(id: string) {
    setError("");
    const response = await fetch(`/api/images/${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <Stack spacing={3}>
      <Card component="section">
        <CardHeader title="上传 ISO" />
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              支持 Ubuntu、Debian、Rocky Linux、AlmaLinux 的 x86_64 安装 ISO，以及用 dd 导出的 Ubuntu / Debian 整盘镜像（GPT，根分区 ext4 且在最后）。格式：{ISO_FORMATS_LABEL}，压缩的导入后自动解压。按 4MB 一段上传，网络抖动会自动重试；断开的上传会留在下面的任务里，可以继续或取消，传完自动识别抽取。
            </Typography>
            <Stack spacing={2} sx={{ maxWidth: { sm: 448 }, alignItems: "flex-start" }}>
              <TextField id="upload-name" label="显示名称" value={uploadName} placeholder="可留空，默认用文件名" onChange={(event) => setUploadName(event.target.value)} fullWidth />
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, maxWidth: "100%" }}>
                <Button component="label" variant="outlined" startIcon={<UploadFileOutlined />} sx={{ flexShrink: 0 }}>
                  选择文件
                  <input
                    key={pickerKey}
                    type="file"
                    hidden
                    accept={ISO_ACCEPT}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] || null);
                      setError("");
                    }}
                  />
                </Button>
                <Typography variant="body2" noWrap title={file?.name} sx={{ minWidth: 0, color: file ? "text.primary" : "text.secondary" }}>
                  {file ? `${file.name}（${formatBytes(file.size)}）` : "未选择文件"}
                </Typography>
              </Stack>
              {resumable ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  这个文件上次传到 {formatBytes(resumable.offset)}（{percent(resumable.offset, resumable.size)}%），会从这里继续。
                </Typography>
              ) : null}
              <Button variant="contained" disabled={live.running || !file} onClick={startSelected}>
                {resumable ? `从 ${percent(resumable.offset, resumable.size)}% 继续上传` : "上传并抽取"}
              </Button>
              {live.running ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  一次传一个。切到别的页面会继续传，进度在右下角的小窗里；只是不要刷新或关闭页面。
                </Typography>
              ) : null}
            </Stack>
            {error ? (
              <Typography variant="body2" sx={{ color: "error.main" }}>
                {error}
              </Typography>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <input
        ref={resumePicker}
        type="file"
        accept={ISO_ACCEPT}
        hidden
        onChange={(event) => {
          resumeWith(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {tasks.length ? (
        <Card component="section">
          <CardHeader title="上传任务" />
          <CardContent>
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              {tasks.map((item) => {
                const running = item.state === "running";
                const taskError = pickErrors[item.id] || item.error;
                return (
                  <Stack key={item.id} spacing={0.75}>
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 0, wordBreak: "break-all" }}>
                        {item.name || item.filename}
                      </Typography>
                      {item.name ? (
                        <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 0, wordBreak: "break-all" }}>
                          {item.filename}
                        </Typography>
                      ) : null}
                      <StatusChip tone={running ? "info" : item.state === "error" ? "error" : "neutral"} label={running ? "上传中" : item.state === "error" ? "已中断" : "已暂停"} />
                      <Stack direction="row" spacing={0.5} sx={{ ml: "auto" }}>
                        {running ? (
                          <Button variant="outlined" onClick={live.pause}>
                            暂停
                          </Button>
                        ) : item.id.startsWith("failed-") ? null : (
                          <Button variant="outlined" disabled={live.running} onClick={() => resume(item)}>
                            继续
                          </Button>
                        )}
                        <Button onClick={() => cancel(item)}>{item.id.startsWith("failed-") ? "关闭" : "取消"}</Button>
                      </Stack>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={percent(item.offset, item.size)}
                      color={running ? "primary" : "inherit"}
                      sx={{ height: 8, borderRadius: 4, color: running ? undefined : "text.disabled" }}
                    />
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {formatBytes(item.offset)} / {formatBytes(item.size)}（{percent(item.offset, item.size)}%）
                      {running ? "" : ` · 最后更新 ${formatTime(item.updatedAt)}`}
                      {!running && !live.hasFile(item.id) && !item.id.startsWith("failed-") ? " · 继续时需要重新选择这个文件" : ""}
                    </Typography>
                    {taskError ? (
                      <Typography variant="caption" sx={{ color: "error.main" }}>
                        {taskError}
                      </Typography>
                    ) : null}
                  </Stack>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      {images.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          还没有镜像。上传安装 ISO 后会出现在这里。
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>镜像名称</TableCell>
                <TableCell>系统版本</TableCell>
                <TableCell>大小</TableCell>
                <TableCell>状态</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {images.map((image) => (
                <TableRow key={image.id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {image.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {image.filename}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {image.status === "ready" ? (
                      <>
                        <Typography variant="body2">
                          {FAMILY_LABEL[image.family]}
                          {image.kind === "disk" ? (
                            <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
                              {" "}
                              · 整盘镜像，可写盘或内存运行
                            </Typography>
                          ) : null}
                        </Typography>
                        <Typography variant="caption" component="div" sx={{ maxWidth: 384, color: "text.secondary" }}>
                          {image.version}
                        </Typography>
                      </>
                    ) : image.status === "error" ? (
                      "未识别"
                    ) : (
                      "识别中"
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{image.size ? formatBytes(image.size) : "—"}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={image.status === "ready" ? "success" : image.status === "error" ? "error" : "info"}
                      label={image.status === "ready" ? "可安装" : image.status === "error" ? "失败" : "抽取中"}
                    />
                    {image.error ? (
                      <Typography variant="caption" component="div" sx={{ mt: 0.5, maxWidth: 384, color: "error.main" }}>
                        {image.error}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Button color="error" onClick={() => remove(image.id)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
