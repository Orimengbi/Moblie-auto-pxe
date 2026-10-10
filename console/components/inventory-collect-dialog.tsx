"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/lib/client-api";
import type { BmcSettingKind, InventorySource } from "@/lib/types";

export interface CollectTarget {
  /** 资产 id。 */
  id: string;
  sn: string;
  /** 不是服务器的（交换机等）跳过，它们走 SNMP。 */
  type?: string;
  bmcIp: string;
}

/**
 * 多选后一起采集硬件配置：发起一个批量任务，进度和每台的结果在右上角「任务」和任务页里看。
 * 系统内是 SSH 进系统读，BMC 是经 Redfish 读（关机也能读，一台 GPU 机器要一两分钟）。
 * BMC 设置、BIOS 设置也经 Redfish 读，存成侧边栏 BMC、BIOS 页上「上次读到的」，BIOS 和上次比有变化会列在任务结果里。
 */
export function InventoryCollectDialog({ targets, projectId, onClose }: { targets: CollectTarget[]; projectId?: string; onClose: () => void }) {
  const open = targets.length > 0;
  const [sources, setSources] = useState<InventorySource[]>(["os", "bmc"]);
  const [settings, setSettings] = useState<BmcSettingKind[]>(["overview", "bios"]);
  const [concurrency, setConcurrency] = useState(8);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [taskId, setTaskId] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setTaskId("");
  }, [open]);

  const servers = targets.filter((target) => !target.type || target.type === "server");
  const skipped = targets.length - servers.length;
  const noBmc = servers.filter((target) => !target.bmcIp).length;

  async function start() {
    setPending(true);
    setError("");
    const result = await api<{ id: string }>("/api/tasks", "POST", {
      kind: "inventory",
      sources,
      settings,
      assetIds: servers.map((target) => target.id),
      ...(projectId ? { projectId } : {}),
      concurrency,
      timeoutSec: 900,
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setTaskId(result.data.id);
    // 右上角任务列表马上刷新。
    window.dispatchEvent(new Event("pxe:import-jobs"));
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>采集 {servers.length} 台的硬件配置</DialogTitle>
      <DialogContent>
        {taskId ? (
          <Stack spacing={1}>
            <Typography variant="body2">已经开始采集，可以关掉这个窗口去干别的。进度在右上角「任务」里，每台的结果在任务页。</Typography>
            <MuiLink component={Link} href={`/tasks/${taskId}`} onClick={onClose}>
              打开任务页
            </MuiLink>
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Stack direction="row" spacing={2}>
              {(["os", "bmc"] as const).map((value) => (
                <FormControlLabel
                  key={value}
                  control={<Checkbox checked={sources.includes(value)} onChange={() => setSources((list) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]))} />}
                  label={value === "os" ? "系统内（SSH）" : "BMC（Redfish）"}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={2} sx={{ mt: "0 !important" }}>
              {(["overview", "bios"] as const).map((value) => (
                <FormControlLabel
                  key={value}
                  control={<Checkbox checked={settings.includes(value)} onChange={() => setSettings((list) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]))} />}
                  label={value === "overview" ? "BMC 设置" : "BIOS 设置"}
                />
              ))}
            </Stack>
            <TextField
              label="同时采集几台"
              type="number"
              size="small"
              value={concurrency}
              onChange={(event) => setConcurrency(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
              slotProps={{ htmlInput: { min: 1, max: 50 } }}
              sx={{ width: 160 }}
            />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              BMC 采集每台要一两分钟（BMC 一次只处理一个请求），多台同时跑互不影响。系统内采集要能用控制台的密钥 SSH 登录。BMC 设置是引导、定位灯、虚拟介质这些概况，BIOS 设置是全部设置项，读完在侧边栏 BMC、BIOS 页能看到，BIOS 和上次读的比有变化会列在任务结果里。
              {skipped ? ` 选中的里有 ${skipped} 台不是服务器，跳过。` : ""}
              {noBmc && (sources.includes("bmc") || settings.length) ? ` 有 ${noBmc} 台没有 BMC 地址，只能采系统内的。` : ""}
            </Typography>
            {error ? (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{taskId ? "关闭" : "取消"}</Button>
        {taskId ? null : (
          <Button variant="contained" disabled={pending || (!sources.length && !settings.length) || !servers.length} onClick={() => void start()}>
            {pending ? "正在发起" : "开始采集"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
