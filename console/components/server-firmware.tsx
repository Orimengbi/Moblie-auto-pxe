"use client";

import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { ReadBar } from "@/components/server-bmc";
import { isHgxFirmware } from "@/lib/asset-labels";
import type { BmcOverview, FirmwareItem } from "@/lib/bmc-redfish";
import { api } from "@/lib/client-api";
import { useCan } from "@/components/role-context";

const MONO = "var(--font-geist-mono), monospace";

type Update = BmcOverview["firmwareUpdate"];

/**
 * 侧边栏「固件」：各部件的固件版本（HGX 机器能只看底板或主板），和让 BMC 从网址下载刷写。
 * 打开时只显示上次读到的，点按钮才读 BMC。升级状态取自 BMC 概况，读取时一起刷新。
 */
export function ServerFirmware({ assetId }: { assetId: string }) {
  const [data, setData] = useState<{ readAt: string; items: FirmwareItem[] | null }>({ readAt: "", items: null });
  // undefined：还没读过 BMC 概况，不知道支不支持升级。
  const [update, setUpdate] = useState<Update | undefined>(undefined);
  const [scope, setScope] = useState<"all" | "hgx" | "other">("all");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAdmin = useCan("admin");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [imageUri, setImageUri] = useState("");
  const [component, setComponent] = useState("");

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

  const items = data.items;
  const hgxCount = items?.filter((item) => isHgxFirmware(item.id)).length || 0;
  const shownItems = items?.filter((item) => scope === "all" || (scope === "hgx") === isHgxFirmware(item.id)) || null;

  async function submit() {
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
      {update !== undefined ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" sx={{ flex: 1, color: update && (update.status || update.target) ? "text.primary" : "text.secondary" }}>
            {update && (update.status || update.target)
              ? `BMC 上的升级：${update.target || "—"} ${update.status}${update.percent !== null ? `，${update.percent}%` : ""}`
              : update
                ? "没有进行中的升级"
                : "这台 BMC 不支持从网址升级"}
          </Typography>
          {update && isAdmin ? (
            <Button size="small" variant="outlined" disabled={busy} onClick={() => setOpen(true)}>
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
      {shownItems ? (
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& td": { py: 0.5, pr: 2, borderBottom: 1, borderColor: "divider", fontSize: 13, verticalAlign: "top" } }}>
          <tbody>
            {shownItems.map((item) => (
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
    </Stack>
  );
}
