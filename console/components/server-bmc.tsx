"use client";

import { useCallback, useEffect, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import ArrowDownwardOutlined from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowUpwardOutlined from "@mui/icons-material/ArrowUpwardOutlined";
import { StatusChip } from "@/components/mui/status-chip";
import type { Tone } from "@/lib/asset-labels";
import type { BmcOverview, FirmwareItem } from "@/lib/bmc-redfish";
import { api } from "@/lib/client-api";
import type { StreamStatus } from "@/lib/redfish-events";
import { formatTime } from "@/lib/time";

const MONO = "var(--font-geist-mono), monospace";

type View = BmcOverview & { isos: { name: string; url: string }[]; events: StreamStatus };

/** Redfish 引导目标的中文名，没列的照原样显示。 */
const BOOT_TARGETS: Record<string, string> = {
  None: "不覆盖（按启动顺序）",
  Pxe: "网卡 PXE",
  Hdd: "硬盘",
  Cd: "光驱 / 虚拟光驱",
  Usb: "U 盘",
  Floppy: "软驱 / 可移动介质",
  BiosSetup: "进 BIOS 设置",
  UefiShell: "UEFI Shell",
  UefiHttp: "UEFI HTTP 启动",
  RemoteDrive: "远程磁盘",
  SDCard: "SD 卡",
  Utilities: "工具",
  UefiTarget: "指定 UEFI 设备",
  UefiBootNext: "BootNext",
};

const OVERRIDE_ENABLED: Record<string, string> = { Disabled: "关闭", Once: "只下一次", Continuous: "以后每次" };

const LED_LABEL: Record<string, string> = { Off: "关", Lit: "常亮", Blinking: "闪烁" };

export function powerTone(state: string): Tone {
  return state === "On" ? "success" : state === "Off" ? "neutral" : "warning";
}

export function healthTone(health: string): Tone {
  return health === "OK" ? "success" : health === "Warning" ? "warning" : health === "Critical" ? "error" : "neutral";
}

function Section({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap" }} useFlexGap>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {extra}
      </Stack>
      {children}
    </Paper>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontFamily: MONO }}>
        {value || "—"}
      </Typography>
    </Box>
  );
}

function watts(value: number | null): string {
  return value === null ? "" : `${value} W`;
}

/** 侧边栏「BMC」：经 Redfish 看和改引导、定位灯、资产编号、虚拟介质、功耗、固件。 */
export function ServerBmc({ assetId }: { assetId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await api<View>(`/api/assets/${assetId}/redfish`);
    if (result.ok) {
      setView(result.data);
      setError("");
    } else setError(result.error);
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 发一个改动，成功后显示 BMC 的回复并重新读一遍。 */
  async function send(url: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setMessage("");
    const result = await api<{ message?: string }>(url, method, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setError("");
    setMessage(result.data.message || "已完成");
    await load();
    return true;
  }

  if (!view)
    return (
      <Typography variant="body2" sx={{ color: error ? "error.main" : "text.secondary" }}>
        {error || "正在经 Redfish 读 BMC（第一次要十几秒）"}
      </Typography>
    );

  return (
    <Stack spacing={2}>
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
      <Section
        title="整机"
        extra={
          <Button size="small" onClick={() => void load()} disabled={busy}>
            刷新
          </Button>
        }
      >
        <Stack direction="row" useFlexGap spacing={2.5} sx={{ flexWrap: "wrap" }}>
          <Fact label="电源" value={<StatusChip tone={powerTone(view.powerState)} label={view.powerState === "On" ? "开机" : view.powerState === "Off" ? "关机" : view.powerState || "未知"} />} />
          <Fact label="健康" value={<StatusChip tone={healthTone(view.health)} label={view.health || "未知"} />} />
          <Fact label="型号" value={`${view.manufacturer} ${view.model}`.trim()} />
          <Fact label="序列号" value={view.serial} />
          <Fact label="BIOS" value={view.biosVersion} />
          <Fact label="BMC 固件" value={view.bmcVersion} />
          <Fact label="BMC 时间" value={view.bmcTime ? formatTime(view.bmcTime) : ""} />
          <Fact label="Redfish 账号" value={`${view.user}@${view.host}`} />
        </Stack>
        {view.power ? (
          <Stack direction="row" useFlexGap spacing={2.5} sx={{ flexWrap: "wrap", mt: 2 }}>
            <Fact label="当前功耗" value={watts(view.power.consumedWatts)} />
            <Fact label="平均 / 最高 / 最低" value={[view.power.averageWatts, view.power.maxWatts, view.power.minWatts].map((item) => (item === null ? "—" : item)).join(" / ") + " W"} />
            <Fact label="电源容量" value={watts(view.power.capacityWatts)} />
            <Fact label="功率上限（BMC 设定）" value={view.power.limitWatts === null ? "" : `${view.power.limitWatts} W，超限 ${view.power.limitException || "—"}`} />
          </Stack>
        ) : null}
        <EventStreamLine status={view.events} />
        {view.errors.length ? (
          <Typography variant="caption" sx={{ display: "block", mt: 1, color: "warning.main" }}>
            部分没读到：{view.errors.join("；")}
          </Typography>
        ) : null}
      </Section>

      <BootSection view={view} busy={busy} onSave={(body) => send(`/api/assets/${assetId}/redfish`, "PATCH", body)} />

      <Section title="定位灯和资产编号">
        <Stack direction="row" useFlexGap spacing={3} sx={{ flexWrap: "wrap", alignItems: "center" }}>
          {view.ledValues.length ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="body2">定位灯</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={view.led}
                disabled={busy}
                onChange={(_, value: string | null) => {
                  if (value && value !== view.led) void send(`/api/assets/${assetId}/redfish`, "PATCH", { led: value });
                }}
              >
                {view.ledValues.map((value) => (
                  <ToggleButton key={value} value={value} sx={{ px: 1.5 }}>
                    {LED_LABEL[value] || value}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              这台 BMC 没有定位灯接口
            </Typography>
          )}
          <AssetTagField value={view.assetTag} busy={busy} onSave={(assetTag) => send(`/api/assets/${assetId}/redfish`, "PATCH", { assetTag })} />
        </Stack>
        <Typography variant="caption" sx={{ display: "block", mt: 1, color: "text.secondary" }}>
          BMC 改灯要几秒钟才反映出来。AMI 的「闪烁」大约 15 秒后自己熄灭，要一直亮选「常亮」。
        </Typography>
      </Section>

      <MediaSection view={view} busy={busy} onSend={(body) => send(`/api/assets/${assetId}/redfish/media`, "POST", body)} />

      <FirmwareSection assetId={assetId} view={view} busy={busy} onSend={(body) => send(`/api/assets/${assetId}/redfish/firmware`, "POST", body)} />
    </Stack>
  );
}

export function EventStreamLine({ status }: { status: StreamStatus }) {
  const text =
    status.state === "connected"
      ? `已连上，${formatTime(status.since)} 起收到 ${status.events} 条`
      : status.state === "connecting"
        ? "正在连接"
        : status.state === "waiting"
          ? `断开了，稍后重连${status.error ? `（${status.error}）` : ""}`
          : "没有连（这台不在监控范围，或在 设置 → 监控 里关了实时事件）";
  return (
    <Typography variant="caption" sx={{ display: "block", mt: 1.5, color: "text.secondary" }}>
      BMC 实时事件：
      <Box component="span" sx={{ color: status.state === "connected" ? "success.main" : status.state === "waiting" ? "warning.main" : "text.secondary" }}>
        {text}
      </Box>
    </Typography>
  );
}

function AssetTagField({ value, busy, onSave }: { value: string; busy: boolean; onSave: (value: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <TextField label="BMC 里的资产编号" size="small" value={draft} onChange={(event) => setDraft(event.target.value)} slotProps={{ htmlInput: { maxLength: 64, style: { fontFamily: MONO } } }} />
      <Button size="small" disabled={busy || draft === value} onClick={() => void onSave(draft)}>
        写入
      </Button>
    </Stack>
  );
}

function BootSection({ view, busy, onSave }: { view: View; busy: boolean; onSave: (body: unknown) => Promise<boolean> }) {
  const [target, setTarget] = useState(view.boot.target);
  const [enabled, setEnabled] = useState(view.boot.enabled);
  const [mode, setMode] = useState(view.boot.mode);
  const [order, setOrder] = useState(view.boot.order);
  useEffect(() => {
    setTarget(view.boot.target);
    setEnabled(view.boot.enabled);
    setMode(view.boot.mode);
    setOrder(view.boot.order);
  }, [view]);
  const orderChanged = order.some((item, index) => item.ref !== view.boot.order[index]?.ref);
  const overrideChanged = target !== view.boot.target || enabled !== view.boot.enabled || mode !== view.boot.mode;
  const move = (index: number, delta: number) => {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setOrder(next);
  };
  const pendingNames = view.boot.pendingOrder.map((ref) => view.boot.order.find((item) => item.ref === ref)?.name || ref);

  return (
    <Section title="引导">
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField select size="small" label="下次从哪启动" value={target} onChange={(event) => setTarget(event.target.value)} sx={{ minWidth: 200 }}>
          {view.boot.targets.map((value) => (
            <MenuItem key={value} value={value}>
              {BOOT_TARGETS[value] || value}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="生效" value={enabled} onChange={(event) => setEnabled(event.target.value)} sx={{ minWidth: 130 }}>
          {view.boot.enabledValues.map((value) => (
            <MenuItem key={value} value={value}>
              {OVERRIDE_ENABLED[value] || value}
            </MenuItem>
          ))}
        </TextField>
        {view.boot.modes.length ? (
          <TextField select size="small" label="模式" value={mode} onChange={(event) => setMode(event.target.value)} sx={{ minWidth: 110 }}>
            {view.boot.modes.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <Button variant="contained" size="small" disabled={busy || !overrideChanged} onClick={() => void onSave({ boot: { target, enabled, mode: mode || undefined } })}>
          设置
        </Button>
      </Stack>
      <Typography variant="caption" sx={{ display: "block", mt: 1, color: "text.secondary" }}>
        只改引导，不重启。要马上从这里启动，再到「概况」里重启。
      </Typography>

      {order.length ? (
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              启动顺序
            </Typography>
            {orderChanged ? (
              <>
                <Button size="small" onClick={() => setOrder(view.boot.order)} disabled={busy}>
                  还原
                </Button>
                <Button size="small" variant="contained" disabled={busy} onClick={() => void onSave({ bootOrder: order.map((item) => item.ref) })}>
                  保存顺序
                </Button>
              </>
            ) : null}
          </Stack>
          {pendingNames.length ? (
            <Typography variant="caption" sx={{ display: "block", color: "warning.main" }}>
              有改过还没生效的顺序（下次开机生效），第一项是 {pendingNames[0]}
            </Typography>
          ) : null}
          <List dense disablePadding sx={{ mt: 0.5, maxHeight: 320, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
            {order.map((item, index) => (
              <ListItem
                key={item.ref}
                divider={index < order.length - 1}
                secondaryAction={
                  <Stack direction="row">
                    <IconButton size="small" aria-label="上移" disabled={index === 0} onClick={() => move(index, -1)}>
                      <ArrowUpwardOutlined fontSize="inherit" />
                    </IconButton>
                    <IconButton size="small" aria-label="下移" disabled={index === order.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDownwardOutlined fontSize="inherit" />
                    </IconButton>
                  </Stack>
                }
              >
                <ListItemText
                  primary={`${index + 1}. ${item.name}`}
                  secondary={item.enabled ? item.ref : `${item.ref}（已禁用）`}
                  slotProps={{ primary: { variant: "body2" }, secondary: { sx: { fontFamily: MONO, fontSize: 11 } } }}
                />
              </ListItem>
            ))}
          </List>
          <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "text.secondary" }}>
            改顺序写进 BMC 的待生效设置，下次开机 BIOS 才应用。
          </Typography>
        </Box>
      ) : null}
    </Section>
  );
}

function MediaSection({ view, busy, onSend }: { view: View; busy: boolean; onSend: (body: unknown) => Promise<boolean> }) {
  const [slot, setSlot] = useState<string | null>(null);
  const [image, setImage] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { media } = view;
  const enabled = media.rmedia !== "Disabled";
  // AMI 的 BMC 只连 80 端口，控制台的 ISO 在 8080 上时它用不了，不列出来。
  const isos = media.rmedia ? view.isos.filter((item) => !/^https?:\/\/[^/:]+:(?!80\/)\d+\//.test(item.url)) : view.isos;

  async function insert() {
    if (!slot) return;
    if (await onSend({ action: "insert", slot, image, username: username || undefined, password: password || undefined })) {
      setSlot(null);
      setImage("");
      setPassword("");
    }
  }

  return (
    <Section
      title="虚拟介质"
      extra={
        media.canEnable ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <StatusChip tone={enabled ? "success" : "neutral"} label={enabled ? "远程介质已打开" : "远程介质关着"} />
            <Button size="small" disabled={busy} onClick={() => void onSend({ action: enabled ? "disable" : "enable" })}>
              {enabled ? "关闭" : "打开"}
            </Button>
          </Stack>
        ) : null
      }
    >
      {!media.slots.length ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          这台 BMC 没有虚拟介质接口
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          {media.slots.map((item) => (
            <Stack key={item.id} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.5, borderBottom: 1, borderColor: "divider" }}>
              <Typography variant="body2" sx={{ fontFamily: MONO, width: 140, flexShrink: 0 }}>
                {item.id}
              </Typography>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: "break-all", color: item.inserted ? "text.primary" : "text.secondary" }}>
                {item.inserted ? item.image || "已挂载" : "空"}
              </Typography>
              {item.inserted ? (
                <Button size="small" disabled={busy} onClick={() => void onSend({ action: "eject", slot: item.id })}>
                  弹出
                </Button>
              ) : (
                <Button size="small" disabled={busy} onClick={() => setSlot(item.id)}>
                  挂载
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      )}
      {media.canEnable && !enabled ? (
        <Typography variant="caption" sx={{ display: "block", mt: 1, color: "text.secondary" }}>
          AMI 的 BMC 要先打开远程介质才能挂载镜像。
        </Typography>
      ) : null}
      <Dialog open={Boolean(slot)} onClose={() => setSlot(null)} fullWidth maxWidth="sm">
        <DialogTitle>挂载到 {slot}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              freeSolo
              options={isos.map((item) => item.url)}
              getOptionLabel={(option) => isos.find((item) => item.url === option)?.name || option}
              renderOption={(props, option) => (
                <li {...props} key={option}>
                  <Box>
                    <Typography variant="body2">{isos.find((item) => item.url === option)?.name}</Typography>
                    <Typography variant="caption" sx={{ fontFamily: MONO, color: "text.secondary" }}>
                      {option}
                    </Typography>
                  </Box>
                </li>
              )}
              inputValue={image}
              onInputChange={(_, value) => setImage(value)}
              onChange={(_, value) => setImage(typeof value === "string" ? value : "")}
              renderInput={(params) => <TextField {...params} label="镜像地址" placeholder="http://… 、nfs://… 或 cifs://…，也可以选控制台里的 ISO" />}
            />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              BMC 自己去这个地址拉镜像，要 BMC 能访问到。列表里控制台的 ISO 只有装机网里的 BMC 能访问。
              {media.rmedia ? " AMI 的 BMC 不管地址里的端口，HTTP 一律连 80 端口；HTTPS 要填用户名密码。" : ""}
            </Typography>
            <Stack direction="row" spacing={2}>
              <TextField label="用户名（CIFS 需要）" size="small" value={username} onChange={(event) => setUsername(event.target.value)} fullWidth />
              <TextField label="密码" size="small" type="password" value={password} onChange={(event) => setPassword(event.target.value)} fullWidth />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSlot(null)}>取消</Button>
          <Button variant="contained" disabled={busy || !image.trim()} onClick={() => void insert()}>
            挂载
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

function FirmwareSection({ assetId, view, busy, onSend }: { assetId: string; view: View; busy: boolean; onSend: (body: unknown) => Promise<boolean> }) {
  const [items, setItems] = useState<FirmwareItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [imageUri, setImageUri] = useState("");
  const [component, setComponent] = useState("");
  const update = view.firmwareUpdate;

  async function loadInventory() {
    setLoading(true);
    const result = await api<{ items: FirmwareItem[] }>(`/api/assets/${assetId}/redfish/firmware`);
    setLoading(false);
    if (result.ok) setItems(result.data.items);
    setError(result.error);
  }

  async function submit() {
    const what = component || "自动识别的部件";
    if (!window.confirm(`让 BMC 从\n${imageUri}\n下载并刷写 ${what}？\n\n刷写期间不要断电。BIOS 要关机或重启后才生效，BMC 刷完会自己重启。`)) return;
    if (await onSend({ imageUri, component: component || undefined })) {
      setOpen(false);
      setImageUri("");
    }
  }

  return (
    <Section
      title="固件"
      extra={
        <Stack direction="row" spacing={1}>
          <Button size="small" disabled={loading} onClick={() => void loadInventory()}>
            {items ? "重新读版本" : "读全部版本"}
          </Button>
          {update ? (
            <Button size="small" disabled={busy} onClick={() => setOpen(true)}>
              升级
            </Button>
          ) : null}
        </Stack>
      }
    >
      {update && (update.status || update.target) ? (
        <Typography variant="body2" sx={{ mb: 1 }}>
          BMC 上的升级：{update.target || "—"} {update.status}
          {update.percent !== null ? `，${update.percent}%` : ""}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary", mb: items ? 1 : 0 }}>
          {update ? "没有进行中的升级" : "这台 BMC 不支持从网址升级"}
        </Typography>
      )}
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      {loading ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          正在读（GPU 机器有上百项，要一会儿）
        </Typography>
      ) : null}
      {items ? (
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& td": { py: 0.5, pr: 2, borderBottom: 1, borderColor: "divider", fontSize: 13, verticalAlign: "top" } }}>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <Box component="td" sx={{ fontFamily: MONO }}>
                  {item.version || "—"}
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
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button variant="contained" color="warning" disabled={busy || !imageUri.trim()} onClick={() => void submit()}>
            开始升级
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}
