"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { StatusChip } from "@/components/mui/status-chip";
import { FONT_MONO } from "@/components/mui/theme";
import type { Tone } from "@/lib/asset-labels";
import { api } from "@/lib/client-api";
import type { BackupInfo, BackupJob, HostAgent, RestoreResult, UpdateBundle, UpdateStatus, VersionHistory } from "@/lib/system";
import { formatTime } from "@/lib/time";

interface SystemState {
  version: string;
  agent: HostAgent | null;
  history: VersionHistory | null;
  update: UpdateStatus;
  bundles: UpdateBundle[];
  backups: BackupInfo[];
  job: BackupJob | null;
  restore: RestoreResult | null;
  busy: string;
}

const UPDATE_LABEL: Record<UpdateStatus["state"], [string, Tone]> = {
  idle: ["没有在升级", "neutral"],
  queued: ["等宿主机接手", "info"],
  running: ["升级中", "info"],
  done: ["升级完成", "success"],
  failed: ["升级失败", "error"],
  "rolled-back": ["失败，已回到原版本", "warning"],
};

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** PUT 整个文件，带进度。fetch 拿不到上传进度，所以用 XHR。 */
function putFile(url: string, file: File, onProgress: (ratio: number) => void): Promise<{ ok: boolean; error: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${url}?name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      let error = "";
      try {
        error = JSON.parse(xhr.responseText)?.error || "";
      } catch {
        // 不是 JSON。
      }
      resolve({ ok: xhr.status < 300, error: xhr.status < 300 ? "" : error || `上传失败（HTTP ${xhr.status}）` });
    };
    xhr.onerror = () => resolve({ ok: false, error: "上传中断，没有连上控制台" });
    xhr.send(file);
  });
}

/** 选一个文件后上传的按钮，传的时候按钮下面显示进度。 */
function UploadButton({ label, accept, url, onDone }: { label: string; accept: string; url: string; onDone: (error: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  return (
    <Box>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setProgress(0);
          const result = await putFile(url, file, setProgress);
          setProgress(null);
          onDone(result.error);
        }}
      />
      <Button variant="outlined" disabled={progress !== null} onClick={() => input.current?.click()}>
        {progress === null ? label : `上传中 ${Math.floor(progress * 100)}%`}
      </Button>
      {progress !== null ? <LinearProgress variant="determinate" value={progress * 100} sx={{ mt: 0.5 }} /> : null}
    </Box>
  );
}

/**
 * 「备份和升级」页：当前版本，上传升级包交给宿主机升级，做备份、下载、上传、恢复。
 * 升级和恢复都会让控制台重启，期间接口连不上；页面一直轮询，连回来后刷新。
 */
export function SystemAdmin({ initial }: { initial: SystemState }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  /** 升级或恢复后等控制台重启：记下发起时的版本，连回来时版本变了或恢复结果有了就整页刷新。 */
  const [waiting, setWaiting] = useState<"" | "update" | "restore">("");
  const [confirm, setConfirm] = useState<{ kind: "update"; bundle: UpdateBundle } | { kind: "restore"; backup: BackupInfo } | null>(null);
  const [pending, setPending] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const refresh = useCallback(async () => {
    const result = await api<SystemState>("/api/system");
    if (!result.ok) {
      setOffline(true);
      return null;
    }
    setOffline(false);
    setState(result.data);
    return result.data;
  }, []);

  const active = waiting !== "" || state.job?.state === "running" || state.update.state === "queued" || state.update.state === "running";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const next = await refresh();
      if (!next) return;
      if (waiting === "update" && (next.version !== initial.version || ["done", "failed", "rolled-back"].includes(next.update.state))) window.location.reload();
      if (waiting === "restore" && next.restore && next.restore.at !== initial.restore?.at) window.location.reload();
    }, 2000);
    return () => clearInterval(timer);
  }, [active, waiting, refresh, initial.version, initial.restore?.at]);

  async function backup(full: boolean) {
    setError("");
    const result = await api("/api/system/backups", "POST", { full });
    if (!result.ok) setError(result.error);
    await refresh();
  }

  async function remove(url: string, what: string) {
    if (!window.confirm(`删除${what}？`)) return;
    const result = await api(url, "DELETE");
    if (!result.ok) setError(result.error);
    await refresh();
  }

  async function confirmed() {
    if (!confirm) return;
    setPending(true);
    setError("");
    if (confirm.kind === "update") {
      const result = await api("/api/system/update", "POST", { file: confirm.bundle.file });
      if (result.ok) {
        setWaiting("update");
        setShowLog(true);
      } else setError(result.error);
    } else {
      const result = await api(`/api/system/backups/${encodeURIComponent(confirm.backup.name)}/restore`, "POST");
      if (result.ok) setWaiting("restore");
      else setError(result.error);
    }
    setPending(false);
    setConfirm(null);
    await refresh();
  }

  const fullBytes = state.backups.find((item) => item.manifest?.full)?.manifest?.bytes;
  const [updateLabel, updateTone] = UPDATE_LABEL[state.update.state] || UPDATE_LABEL.idle;
  const job = state.job;

  return (
    <Stack spacing={2}>
      {offline || waiting ? (
        <Alert severity="info" icon={false}>
          <Stack spacing={1}>
            <span>
              {waiting === "update" ? "正在升级，控制台会重启一次，大约一两分钟。" : waiting === "restore" ? "正在恢复，控制台重启后换进备份的数据。" : "控制台连不上，可能正在重启。"}
              {offline ? "等它回来……" : ""}页面会自动刷新。
            </span>
            <LinearProgress />
          </Stack>
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert severity="success" onClose={() => setNotice("")}>
          {notice}
        </Alert>
      ) : null}
      {state.restore && !waiting ? (
        <Alert severity={state.restore.ok ? "success" : "error"}>
          {formatTime(state.restore.at)} {state.restore.actor ? `${state.restore.actor} ` : ""}
          {state.restore.message}
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="版本和升级" />
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={3} useFlexGap sx={{ flexWrap: "wrap", alignItems: "baseline" }}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  当前版本
                </Typography>
                <Typography variant="h6" sx={{ fontFamily: FONT_MONO }}>
                  {state.version}
                </Typography>
              </Box>
              {state.history?.previous ? (
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    上一个版本
                  </Typography>
                  <Typography sx={{ fontFamily: FONT_MONO }}>{state.history.previous}</Typography>
                </Box>
              ) : null}
              <Box>
                <Typography variant="body2" color="text.secondary">
                  升级状态
                </Typography>
                <StatusChip tone={updateTone} label={updateLabel} />
              </Box>
            </Stack>
            {state.agent ? (
              <Typography variant="body2" color="text.secondary">
                把发布的升级包（pxe-版本号.run）传上来，点「升级」。宿主机会先核对签名、自动备份数据和配置，再换上新版本并检查能不能正常打开；新版本起不来会自动回到原版本和原数据。升级期间控制台会断开一两分钟，正在跑的任务和镜像解包要先等它们结束。
              </Typography>
            ) : (
              <Alert severity="warning">
                这台控制台不是用安装包装的，没有宿主机升级服务，网页上不能升级。用安装包装好的机器上可以网页升级，也可以在命令行执行 <code>sudo bash pxe-版本号.run</code>。
              </Alert>
            )}
            {state.update.state !== "idle" ? (
              <Box>
                <Typography variant="body2">
                  {state.update.from && state.update.to ? `${state.update.from} → ${state.update.to}` : state.update.file}
                  {state.update.step ? `：${state.update.step}` : ""}
                  {state.update.message ? `。${state.update.message}` : ""}
                  {state.update.updatedAt ? `（${formatTime(state.update.updatedAt, "short")}）` : ""}
                </Typography>
                {state.update.log ? (
                  <>
                    <Button size="small" onClick={() => setShowLog((value) => !value)}>
                      {showLog ? "收起日志" : "看日志"}
                    </Button>
                    {showLog ? (
                      <Box component="pre" sx={{ m: 0, p: 1, maxHeight: 320, overflow: "auto", bgcolor: "action.hover", borderRadius: 1, fontFamily: FONT_MONO, fontSize: 12, whiteSpace: "pre-wrap" }}>
                        {state.update.log}
                      </Box>
                    ) : null}
                  </>
                ) : null}
              </Box>
            ) : null}
            {state.agent ? (
              <UploadButton
                label="上传升级包"
                accept=".run"
                url="/api/system/upload/update"
                onDone={(message) => {
                  if (message) setError(message);
                  else setNotice("升级包已上传");
                  refresh();
                }}
              />
            ) : null}
            {state.bundles.length ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>升级包</TableCell>
                    <TableCell>版本</TableCell>
                    <TableCell>打包时间</TableCell>
                    <TableCell>大小</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.bundles.map((bundle) => (
                    <TableRow key={bundle.file}>
                      <TableCell sx={{ fontFamily: FONT_MONO, fontSize: 13 }}>{bundle.file}</TableCell>
                      <TableCell sx={{ fontFamily: FONT_MONO, fontSize: 13 }}>
                        {bundle.version}
                        {bundle.version === state.version ? <StatusChip tone="success" label="当前" sx={{ ml: 1 }} /> : null}
                        {!bundle.signed ? <StatusChip tone="error" label="没签名" sx={{ ml: 1 }} /> : null}
                      </TableCell>
                      <TableCell>{bundle.builtAt ? formatTime(bundle.builtAt, "short") : ""}</TableCell>
                      <TableCell>{size(bundle.size)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                        <Button size="small" variant="contained" disabled={!state.agent || active || bundle.version === state.version} onClick={() => setConfirm({ kind: "update", bundle })}>
                          升级
                        </Button>
                        <Button size="small" color="error" disabled={active} onClick={() => remove(`/api/system/update/${encodeURIComponent(bundle.file)}`, ` ${bundle.file}`)}>
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
            {state.history?.history?.length ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  升级记录
                </Typography>
                <Table size="small">
                  <TableBody>
                    {state.history.history.slice(0, 10).map((item, index) => (
                      <TableRow key={`${item.at}-${index}`}>
                        <TableCell sx={{ width: 160 }}>{formatTime(item.at, "short")}</TableCell>
                        <TableCell sx={{ fontFamily: FONT_MONO, fontSize: 13 }}>{item.version}</TableCell>
                        <TableCell>{item.result}</TableCell>
                        <TableCell>{item.by}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="备份和恢复" />
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              「数据和配置」备份数据库（资产、工单、用户、审计……）、硬件采集记录、装机批次、配置模板、SSH 密钥这些，几十 MB，几秒钟。「完整备份」再加上镜像、固件包，用来整机搬家，要几分钟。备份里有账号、BMC 密码和私钥，下载后妥善保管。升级前和恢复前会自动备份一份数据和配置（各留最近 5 份）。
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              <Button variant="contained" disabled={job?.state === "running"} onClick={() => backup(false)}>
                备份数据和配置
              </Button>
              <Button variant="outlined" disabled={job?.state === "running"} onClick={() => backup(true)}>
                完整备份{fullBytes ? `（上次约 ${size(fullBytes)}）` : ""}
              </Button>
              <UploadButton
                label="上传备份"
                accept=".zst,.gz,.tgz"
                url="/api/system/upload/backup"
                onDone={(message) => {
                  if (message) setError(message);
                  else setNotice("备份已上传，在下面的列表里点「恢复」");
                  refresh();
                }}
              />
            </Stack>
            {job?.state === "running" ? (
              <Box>
                <Typography variant="body2">正在做{job.full ? "完整备份" : "数据和配置备份"}……</Typography>
                <LinearProgress sx={{ mt: 0.5 }} />
              </Box>
            ) : job?.state === "error" ? (
              <Alert severity="error">备份失败：{job.error}</Alert>
            ) : null}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>时间</TableCell>
                  <TableCell>内容</TableCell>
                  <TableCell>来源</TableCell>
                  <TableCell>版本</TableCell>
                  <TableCell>大小</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {state.backups.length ? null : (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ color: "text.secondary" }}>
                      还没有备份。
                    </TableCell>
                  </TableRow>
                )}
                {state.backups.map((item) => {
                  const m = item.manifest;
                  return (
                    <TableRow key={item.name}>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{m ? formatTime(m.createdAt, "short") : item.name}</TableCell>
                      <TableCell>{m ? <StatusChip tone={m.full ? "primary" : "neutral"} label={m.full ? "完整" : "数据和配置"} /> : "?"}</TableCell>
                      <TableCell>
                        {m ? `${m.reason}${m.actor && m.actor !== "系统" ? ` · ${m.actor}` : ""}` : ""}
                        {m && m.hostname ? (
                          <Typography component="span" variant="body2" color="text.secondary">
                            {" "}
                            @{m.hostname}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell sx={{ fontFamily: FONT_MONO, fontSize: 13 }}>{m?.version}</TableCell>
                      <TableCell>{size(item.size)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                        <Button size="small" href={`/api/system/backups/${encodeURIComponent(item.name)}`}>
                          下载
                        </Button>
                        <Button size="small" disabled={active || !m} onClick={() => setConfirm({ kind: "restore", backup: item })}>
                          恢复
                        </Button>
                        <Button size="small" color="error" disabled={active} onClick={() => remove(`/api/system/backups/${encodeURIComponent(item.name)}`, "这份备份")}>
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={Boolean(confirm)} onClose={() => !pending && setConfirm(null)} maxWidth="sm" fullWidth>
        {confirm?.kind === "update" ? (
          <>
            <DialogTitle>升级到 {confirm.bundle.version}？</DialogTitle>
            <DialogContent>
              <Stack spacing={1}>
                <Typography variant="body2">
                  从 {state.version} 升级到 {confirm.bundle.version}。宿主机先自动备份数据和配置，然后换上新版本，控制台会断开一两分钟。新版本起不来时自动回到 {state.version} 和升级前的数据。
                </Typography>
                {state.busy ? <Alert severity="warning">{state.busy}，现在不能升级。</Alert> : null}
              </Stack>
            </DialogContent>
          </>
        ) : confirm?.kind === "restore" ? (
          <>
            <DialogTitle>恢复这份备份？</DialogTitle>
            <DialogContent>
              <Stack spacing={1}>
                <Typography variant="body2">
                  恢复到 {confirm.backup.manifest ? formatTime(confirm.backup.manifest.createdAt) : ""} 的状态，这之后的改动（资产、工单、用户、审计……）都会丢掉。
                  {confirm.backup.manifest?.full ? "这是完整备份，镜像和固件包也换成备份里的。" : "这份只有数据和配置，现在的镜像和固件包保持不动。"}
                </Typography>
                <Typography variant="body2">恢复前会自动备份一份现在的数据和配置，恢复错了可以再恢复回来。控制台会重启，所有人要重新登录（账号也恢复成备份里的）。</Typography>
                {confirm.backup.manifest && confirm.backup.manifest.version !== state.version ? (
                  <Alert severity="info">备份来自版本 {confirm.backup.manifest.version}，现在是 {state.version}。</Alert>
                ) : null}
                {state.busy ? <Alert severity="warning">{state.busy}，现在不能恢复。</Alert> : null}
              </Stack>
            </DialogContent>
          </>
        ) : null}
        <DialogActions>
          <Button disabled={pending} onClick={() => setConfirm(null)}>
            取消
          </Button>
          <Button variant="contained" color={confirm?.kind === "restore" ? "error" : "primary"} disabled={pending || Boolean(state.busy)} onClick={confirmed}>
            {confirm?.kind === "update" ? "升级" : "恢复"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
