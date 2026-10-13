"use client";

import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { ReadBar } from "@/components/server-bmc";
import { isHgxFirmware } from "@/lib/asset-labels";
import type { BmcOverview, FirmwareItem } from "@/lib/bmc-redfish";
import { FIRMWARE_KIND_LABEL, type FirmwareChoice, type FirmwareKind, type FirmwarePushJob } from "@/lib/firmware-types";
import type { PowerState } from "@/lib/types";
import { formatTime } from "@/lib/time";
import { api } from "@/lib/client-api";
import { useCan } from "@/components/role-context";

const MONO = "var(--font-geist-mono), monospace";

/** 版本下拉里每个包跟这台现在版本比的标注（relation 是「这台比包」）。 */
const CHOICE_RELATION: Record<FirmwareChoice["relation"], { label: string; color: string }> = {
  older: { label: "比现在新", color: "success.main" },
  same: { label: "已是这版", color: "text.secondary" },
  newer: { label: "比现在旧", color: "warning.main" },
  unknown: { label: "比不出", color: "text.secondary" },
  unread: { label: "没读过固件", color: "text.secondary" },
};

type Update = BmcOverview["firmwareUpdate"];

const POWER_LABEL: Record<PowerState, string> = { on: "开机", off: "关机", unknown: "不知道" };

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function minutesSince(at: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60_000));
}

const PUSH_STEPS: { stage: FirmwarePushJob["stage"][]; label: string }[] = [
  { stage: ["prepare"], label: "腾内存" },
  { stage: ["upload"], label: "上传" },
  { stage: ["verify"], label: "BMC 校验" },
  { stage: ["flash"], label: "BMC 刷写" },
  { stage: ["done", "failed"], label: "结束" },
];

/** 一次从固件库推送的进度：走到哪一步、上传和刷写的百分比、BMC 最近的消息。 */
function PushProgress({ job }: { job: FirmwarePushJob }) {
  const active = job.stage !== "done" && job.stage !== "failed";
  const current = PUSH_STEPS.findIndex((step) => step.stage.includes(job.stage));
  // 刷写任务的百分比是空的（AMI），就用 BMC 升级状态里的。
  const flashValue = job.percent ?? job.bmcPercent ?? null;
  const uploadPercent = job.total ? Math.floor((job.sent / job.total) * 100) : 0;
  const text =
    job.stage === "prepare"
      ? "让 BMC 腾内存（HMC 升级前要先做，可能要一两分钟）"
      : job.stage === "upload"
        ? `正在把镜像传给 BMC：${uploadPercent}%（${sizeLabel(job.sent)} / ${sizeLabel(job.total)}）`
        : job.stage === "verify"
          ? "镜像传完了，BMC 正在校验，校验完会建刷写任务"
          : job.stage === "flash"
            ? `BMC 正在刷写：${job.bmcStatus || job.taskState || "已提交"}${flashValue !== null ? `，${flashValue}%` : ""}${job.flashAt ? `（已经 ${minutesSince(job.flashAt)} 分钟）` : ""}`
            : job.stage === "done"
              ? "刷写完成。点「读取」看新版本。"
              : `没成功：${job.error}`;
  const value = job.stage === "upload" ? uploadPercent : job.stage === "flash" ? flashValue : job.stage === "done" ? 100 : null;
  return (
    <Alert severity={job.stage === "failed" ? "error" : job.stage === "done" ? "success" : "info"} icon={false} sx={{ "& .MuiAlert-message": { width: "100%" } }}>
      <Stack spacing={1}>
        <Typography variant="subtitle2">
          推送 {job.kind} {job.version}
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {job.user} {formatTime(job.startedAt)} 开始{job.finishedAt ? `，${formatTime(job.finishedAt)} 结束` : ""}
          </Typography>
        </Typography>
        <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: "wrap" }}>
          {PUSH_STEPS.map((step, index) => (
            <Typography
              key={step.label}
              variant="caption"
              sx={{ px: 1, py: 0.25, borderRadius: 1, bgcolor: index === current ? "action.selected" : "transparent", color: index <= current ? "text.primary" : "text.disabled", fontWeight: index === current ? 600 : 400 }}
            >
              {index < current ? "✓ " : ""}
              {step.label}
            </Typography>
          ))}
        </Stack>
        {active || job.stage === "done" ? <LinearProgress variant={value === null ? "indeterminate" : "determinate"} value={value ?? undefined} /> : null}
        <Typography variant="body2">{text}</Typography>
        {job.stage === "flash" ? (
          <Typography variant="caption" color="text.secondary">
            HGX 全量升级大约 30~40 分钟，分几段刷，每段的百分比会从 0 重新走，段与段之间 BMC 不报百分比（进度条来回滚）；期间主机会重启、BMC 偶尔连不上，读不到会接着等。可以关掉页面，回来再看。
          </Typography>
        ) : null}
        {active && job.error ? (
          <Typography variant="caption" color="text.secondary">
            {job.error}
          </Typography>
        ) : null}
        {job.messages.length ? (
          <Box component="ul" sx={{ m: 0, pl: 2, fontSize: 12, color: "text.secondary" }}>
            {job.messages.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </Box>
        ) : null}
      </Stack>
    </Alert>
  );
}

/**
 * 侧边栏「固件」：各部件的固件版本（HGX 机器能只看底板或主板），和升级：
 * 从固件库选包由控制台推给 BMC，或者让 BMC 从网址自己下载。
 * 打开时只显示上次读到的，点按钮才读 BMC。升级状态取自 BMC 概况，读取时一起刷新。
 */
export function ServerFirmware({ assetId }: { assetId: string }) {
  const [data, setData] = useState<{ readAt: string; items: FirmwareItem[] | null }>({ readAt: "", items: null });
  // undefined：还没读过 BMC 概况，不知道支不支持升级。
  const [update, setUpdate] = useState<Update | undefined>(undefined);
  const [scope, setScope] = useState<"all" | "hgx" | "other">("all");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const canFlash = useCan("firmware");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [imageUri, setImageUri] = useState("");
  const [component, setComponent] = useState("");
  const [source, setSource] = useState<"library" | "url">("library");
  const [library, setLibrary] = useState<{ choices: FirmwareChoice[]; power: PowerState; powerAt: string } | null>(null);
  const [kind, setKind] = useState<FirmwareKind | "">("");
  const [choiceId, setChoiceId] = useState("");
  const [image, setImage] = useState("");
  const [targets, setTargets] = useState("");
  const [oem, setOem] = useState("");
  const [prepareHmc, setPrepareHmc] = useState(false);
  const [task, setTask] = useState<{ path: string; state: string; percent: number | null; messages: string[] } | null>(null);
  const [push, setPush] = useState<FirmwarePushJob | null>(null);
  const choice = library?.choices.find((item) => item.id === choiceId) || null;
  const kinds = [...new Set(library?.choices.map((item) => item.kind) || [])];
  const versions = library?.choices.filter((item) => item.kind === kind) || [];

  function pick(next: FirmwareChoice | null) {
    setChoiceId(next?.id || "");
    setImage(next?.image || "");
    setTargets(next?.targets.join("\n") || "");
    setOem(next ? JSON.stringify(next.oem) : "");
    setPrepareHmc(Boolean(next?.prepareHmc));
  }

  /** 换部件时默认选比这台新的里最新的那个包，没有就选最新的。 */
  function pickKind(next: FirmwareKind, choices: FirmwareChoice[]) {
    setKind(next);
    const ofKind = choices.filter((item) => item.kind === next);
    pick(ofKind.find((item) => item.relation === "older") || ofKind[0] || null);
  }

  async function openDialog() {
    setOpen(true);
    const result = await api<{ choices: FirmwareChoice[]; power: PowerState; powerAt: string }>(`/api/assets/${assetId}/redfish/firmware?library=1`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLibrary(result.data);
    setSource(result.data.choices.length ? "library" : "url");
    const choices = result.data.choices;
    const first = choices.find((item) => item.relation === "older") || choices[0];
    if (first) pickKind(first.kind, choices);
    else {
      setKind("");
      pick(null);
    }
  }

  // 提交后每 10 秒看一次 BMC 上这个任务走到哪了，结束就停。
  useEffect(() => {
    if (!task?.path || /^(Completed|Exception|Killed|Cancelled)$/i.test(task.state)) return;
    const timer = window.setTimeout(async () => {
      const result = await api<{ state: string; percent: number | null; messages: string[] }>(`/api/assets/${assetId}/redfish/firmware?task=${encodeURIComponent(task.path)}`);
      if (result.ok) setTask({ path: task.path, ...result.data });
      else setTask({ ...task, state: task.state || "读不到进度", messages: [result.error] });
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [assetId, task]);

  const loadUpdate = useCallback(
    async (refresh: boolean) => {
      const result = await api<{ overview: BmcOverview | null }>(`/api/assets/${assetId}/redfish${refresh ? "?refresh=1" : ""}`);
      if (result.ok) setUpdate(result.data.overview ? result.data.overview.firmwareUpdate : undefined);
      return result.error;
    },
    [assetId],
  );

  const loadInventory = useCallback(
    async (refresh: boolean) => {
      const result = await api<{ readAt: string; items: FirmwareItem[] | null }>(`/api/assets/${assetId}/redfish/firmware${refresh ? "?refresh=1" : ""}`);
      if (result.ok) setData(result.data);
      return result.error;
    },
    [assetId],
  );

  /** refresh 为 true 才连 BMC，版本清单和升级状态一起读。 */
  const load = useCallback(
    async (refresh: boolean) => {
      if (refresh) setReading(true);
      const errors = await Promise.all([loadInventory(refresh), loadUpdate(refresh)]);
      setReading(false);
      setError(errors.filter(Boolean).join("；"));
    },
    [loadInventory, loadUpdate],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const loadPush = useCallback(async () => {
    const result = await api<{ job: FirmwarePushJob | null }>(`/api/assets/${assetId}/redfish/firmware?push=1`);
    if (result.ok) setPush(result.data.job);
  }, [assetId]);

  // 推送在控制台后台跑，没结束就每 3 秒看一次。
  useEffect(() => {
    void loadPush();
  }, [loadPush]);
  const pushActive = Boolean(push && push.stage !== "done" && push.stage !== "failed");
  useEffect(() => {
    if (!pushActive) return;
    const timer = window.setInterval(() => void loadPush(), 3000);
    return () => window.clearInterval(timer);
  }, [pushActive, loadPush]);

  const items = data.items;
  const hgxCount = items?.filter((item) => isHgxFirmware(item.id)).length || 0;
  const keptFrom = items?.find((item) => item.keptFrom)?.keptFrom || "";
  const shownItems = items?.filter((item) => scope === "all" || (scope === "hgx") === isHgxFirmware(item.id)) || null;

  async function submitLibrary() {
    if (!choice) return;
    let oemValue: Record<string, unknown>;
    try {
      oemValue = oem.trim() ? JSON.parse(oem) : {};
    } catch {
      setError("OemParameters 不是合法的 JSON");
      return;
    }
    const warnings = [
      choice.relation === "newer" && `包比这台现在的旧（${choice.current} → ${choice.version}），这是降级`,
      choice.kind === "bios" && library?.power === "on" && "机器开着：BIOS 建议关机再刷，刷完开机才生效",
      choice.relation === "same" && `这台已经是 ${choice.version}`,
    ].filter(Boolean);
    const text = `把 ${choice.fileName} 里的\n${image}\n推给这台 BMC 刷写 ${FIRMWARE_KIND_LABEL[choice.kind]} ${choice.version}？${warnings.length ? `\n\n注意：\n${warnings.join("\n")}` : ""}\n\n刷写期间不要断电。`;
    if (!window.confirm(text)) return;
    setBusy(true);
    setMessage("");
    const result = await api<{ message?: string; job?: FirmwarePushJob }>(`/api/assets/${assetId}/redfish/firmware`, "POST", {
      packageId: choice.id,
      image,
      targets: targets.split(/\s*\n\s*/).filter(Boolean),
      oem: oemValue,
      prepareHmc,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage("");
      setError(result.error);
      return;
    }
    setError("");
    setOpen(false);
    if (result.data.job) setPush(result.data.job);
  }

  async function submit() {
    if (source === "library") return submitLibrary();
    const what = component || "自动识别的部件";
    if (!window.confirm(`让 BMC 从\n${imageUri}\n下载并刷写 ${what}？\n\n刷写期间不要断电。BIOS 要关机或重启后才生效，BMC 刷完会自己重启。`)) return;
    setBusy(true);
    setMessage("");
    const result = await api<{ message?: string }>(`/api/assets/${assetId}/redfish/firmware`, "POST", { imageUri, component: component || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setMessage(result.data.message || "已提交");
    setOpen(false);
    setImageUri("");
    await loadUpdate(true);
  }

  return (
    <Stack spacing={2}>
      <ReadBar readAt={data.readAt} reading={reading} onRead={() => void load(true)} hint="正在逐项读固件版本，HGX 机器要十几秒" />
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {message ? (
        <Typography variant="body2" sx={{ color: "success.main" }}>
          {message}
        </Typography>
      ) : null}
      {push ? <PushProgress job={push} /> : null}
      {task ? (
        <Typography variant="body2" sx={{ color: /Exception|Killed|Cancelled/i.test(task.state) ? "error.main" : "text.primary" }}>
          BMC 刷写任务：{task.state || "已提交"}
          {task.percent !== null ? `，${task.percent}%` : ""}
          {task.messages.length ? `（${task.messages.slice(-1)[0]}）` : ""}
        </Typography>
      ) : null}
      {update !== undefined ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" sx={{ flex: 1, color: update && (update.status || update.target) ? "text.primary" : "text.secondary" }}>
            {update && (update.status || update.target)
              ? `BMC 上的升级：${update.target || "—"} ${update.status}${update.percent !== null ? `，${update.percent}%` : ""}`
              : update
                ? "没有进行中的升级"
                : "这台 BMC 不支持从网址升级"}
          </Typography>
          {update && canFlash ? (
            <Button size="small" variant="outlined" disabled={busy || pushActive} onClick={() => void openDialog()}>
              升级
            </Button>
          ) : null}
        </Stack>
      ) : null}
      {items && hgxCount ? (
        <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_, value) => value && setScope(value)}>
          <ToggleButton value="all">全部 {items.length}</ToggleButton>
          <ToggleButton value="hgx">HGX {hgxCount}</ToggleButton>
          <ToggleButton value="other">主板 {items.length - hgxCount}</ToggleButton>
        </ToggleButtonGroup>
      ) : null}
      {keptFrom ? (
        <Typography variant="body2" sx={{ color: "warning.main" }}>
          这次没读到 HGX 的固件（主机关机时 GPU 底板和 HMC 断电，BMC 列不出来），HGX 那几项是 {formatTime(keptFrom)} 读到的。开机几分钟后再点「读取」会更新。
        </Typography>
      ) : null}
      {shownItems ? (
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& td": { py: 0.5, pr: 2, borderBottom: 1, borderColor: "divider", fontSize: 13, verticalAlign: "top" } }}>
          <tbody>
            {shownItems.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <Box component="td" sx={{ fontFamily: MONO, color: item.keptFrom ? "text.secondary" : undefined }}>
                  {item.version || "—"}
                  {item.keptFrom ? <Box component="span" sx={{ fontFamily: "inherit", fontSize: 12 }}>{"（上次读的）"}</Box> : null}
                  {item.redfishVersion !== undefined ? (
                    <Box component="span" title="这台 BMC 的 Redfish 把 BIOS 版本截短了，这里是 BMC 存的原始 SMBIOS 里的完整版本" sx={{ fontFamily: "inherit", fontSize: 12, color: "text.secondary" }}>
                      {`（Redfish 报 ${item.redfishVersion || "空"}）`}
                    </Box>
                  ) : null}
                </Box>
                <Box component="td" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
                  {item.updateable ? "可升级" : ""}
                </Box>
              </tr>
            ))}
          </tbody>
        </Box>
      ) : null}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>升级固件</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, value) => value && setSource(value)}>
              <ToggleButton value="library">从固件库选</ToggleButton>
              <ToggleButton value="url">填网址</ToggleButton>
            </ToggleButtonGroup>
            {source === "library" ? (
              library === null ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  正在读固件库…
                </Typography>
              ) : !library.choices.length ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  固件库里没有适用于这台型号的包。先到「固件库」上传，或者在包上补上这台的型号。
                </Typography>
              ) : (
                <>
                  <TextField select label="升级哪个部件" value={kind} onChange={(event) => pickKind(event.target.value as FirmwareKind, library.choices)} fullWidth>
                    {kinds.map((value) => {
                      const count = library.choices.filter((item) => item.kind === value).length;
                      const newer = library.choices.some((item) => item.kind === value && item.relation === "older");
                      return (
                        <MenuItem key={value} value={value}>
                          {FIRMWARE_KIND_LABEL[value]}
                          <Box component="span" sx={{ ml: 1, color: "text.secondary", fontSize: 13 }}>
                            {count} 个包{newer ? " · 有新版" : ""}
                          </Box>
                        </MenuItem>
                      );
                    })}
                  </TextField>
                  <TextField select label="版本" value={choiceId} onChange={(event) => pick(versions.find((item) => item.id === event.target.value) || null)} fullWidth disabled={!kind}>
                    {versions.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        <Box component="span" sx={{ fontFamily: MONO }}>
                          {item.version || "?"}
                        </Box>
                        <Box component="span" sx={{ mx: 1, color: CHOICE_RELATION[item.relation].color, fontSize: 13 }}>
                          {CHOICE_RELATION[item.relation].label}
                        </Box>
                        <Box component="span" sx={{ color: "text.secondary", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {item.fileName}
                        </Box>
                      </MenuItem>
                    ))}
                  </TextField>
                  {choice ? (
                    <>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        这台现在：{choice.current || (choice.relation === "unread" ? "还没读过固件，先点「读取」" : "没法比")} → 包里：{choice.version || "?"}；电源：{POWER_LABEL[library.power]}
                        {library.powerAt ? `（${formatTime(library.powerAt)} 读的）` : ""}
                      </Typography>
                      {choice.relation === "newer" ? <Alert severity="warning">包比这台现在的旧，刷了是降级。</Alert> : null}
                      {choice.kind === "bios" && library.power === "on" ? <Alert severity="warning">机器开着。BIOS 建议关机再刷，刷完开机才生效。</Alert> : null}
                      <TextField select label="推哪个镜像" value={image} onChange={(event) => setImage(event.target.value)} fullWidth>
                        {choice.images.map((item) => (
                          <MenuItem key={item.path} value={item.path}>
                            <Box component="span" sx={{ fontFamily: MONO }}>
                              {item.path}
                            </Box>
                            &nbsp;· {item.type.toUpperCase()} · {sizeLabel(item.size)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField label="Targets（一行一个）" value={targets} onChange={(event) => setTargets(event.target.value)} multiline minRows={1} fullWidth slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 13 } } }} />
                      <TextField label="OemParameters（JSON）" value={oem} onChange={(event) => setOem(event.target.value)} fullWidth slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 13 } } }} />
                      {choice.kind === "hgx" ? (
                        <FormControlLabel control={<Checkbox size="small" checked={prepareHmc} onChange={(event) => setPrepareHmc(event.target.checked)} />} label={<Typography variant="body2">先让 BMC 腾内存（HMC 升级要）</Typography>} />
                      ) : null}
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        控制台把镜像直接传给 BMC，BMC 不用能访问控制台。Targets 和 OemParameters 按类型预填，一般不用改。只有管理员能提交。
                      </Typography>
                    </>
                  ) : null}
                </>
              )
            ) : (
              <>
                <TextField label="固件地址" value={imageUri} onChange={(event) => setImageUri(event.target.value)} placeholder="http://… 或 ftp://…（AMI 的 .ima / BIOS 的 .bin）" fullWidth slotProps={{ htmlInput: { style: { fontFamily: MONO } } }} />
                {update?.components.length ? (
                  <TextField select label="刷哪个部件" value={component} onChange={(event) => setComponent(event.target.value)} fullWidth>
                    <MenuItem value="">让 BMC 按文件自动识别</MenuItem>
                    {update.components.map((value) => (
                      <MenuItem key={value} value={value}>
                        {value}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  BMC 自己下载，地址要 BMC 能访问到。支持 {update?.protocols.join(" / ") || "HTTP"}。只有管理员能提交。
                </Typography>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button variant="contained" color="warning" disabled={busy || (source === "library" ? !choice || !image : !imageUri.trim())} onClick={() => void submit()}>
            开始升级
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
