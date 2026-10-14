"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
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
import { BMC_SETTING_LABEL } from "@/lib/asset-labels";
import { api } from "@/lib/client-api";
import { COLLECT_KIND_ONLY, COLLECT_KINDS, KIND_LABEL, SOURCE_LABEL } from "@/lib/inventory";
import type { BmcSettingKind, HwKind, InventorySource } from "@/lib/types";

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
 * BMC 设置、BIOS 设置、固件版本也经 Redfish 读，存成侧边栏 BMC、BIOS 页上「上次读到的」，BIOS 和固件和上次比有变化会列在任务结果里。
 */
export function InventoryCollectDialog({
  targets,
  projectId,
  onClose,
  preset,
}: {
  targets: CollectTarget[];
  projectId?: string;
  onClose: () => void;
  /** 打开时默认勾哪些；固件版本页只勾「固件版本」。 */
  preset?: { sources: InventorySource[]; settings: BmcSettingKind[] };
}) {
  const servers = targets.filter((target) => !target.type || target.type === "server");
  const [title, setTitle] = useState("");
  return (
    <Dialog open={targets.length > 0} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title || `采集 ${servers.length} 台的硬件配置`}</DialogTitle>
      <DialogContent>{targets.length ? <InventoryCollectPanel targets={targets} projectId={projectId} preset={preset} onLeave={onClose} onTitle={setTitle} /> : null}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

/** 采集的选项和「开始采集」按钮，单独的对话框和资产页的批量操作框共用。发起后原地显示任务链接。 */
export function InventoryCollectPanel({
  targets,
  projectId,
  preset,
  onLeave,
  onTitle,
}: {
  targets: CollectTarget[];
  projectId?: string;
  preset?: { sources: InventorySource[]; settings: BmcSettingKind[] };
  /** 点了「打开任务页」，外面的框该关了。 */
  onLeave: () => void;
  /** 只读设置、不采硬件时，对话框标题跟着变。 */
  onTitle?: (title: string) => void;
}) {
  const [sources, setSources] = useState<InventorySource[]>(preset?.sources || ["os", "bmc"]);
  const [settings, setSettings] = useState<BmcSettingKind[]>(preset?.settings || ["overview", "bios"]);
  const [kinds, setKinds] = useState<HwKind[]>(COLLECT_KINDS);
  const [concurrency, setConcurrency] = useState(8);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [taskId, setTaskId] = useState("");

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
      ...(kinds.length < COLLECT_KINDS.length ? { kinds } : {}),
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

  const partial = kinds.length < COLLECT_KINDS.length;
  // 挑的类别只有另一边读得到，比如只勾了系统内却只要电源。
  const unreadable = sources.length ? kinds.filter((kind) => COLLECT_KIND_ONLY[kind] && !sources.includes(COLLECT_KIND_ONLY[kind]!)) : [];
  const title = sources.length ? `采集 ${servers.length} 台的${partial && kinds.length ? kinds.map((kind) => KIND_LABEL[kind]).join("、") : "硬件配置"}` : `读取 ${servers.length} 台的${settings.map((item) => BMC_SETTING_LABEL[item]).join("、") || "设置"}`;
  useEffect(() => onTitle?.(title), [title, onTitle]);

  return taskId ? (
          <Stack spacing={1}>
            <Typography variant="body2">已经开始采集，可以关掉这个窗口去干别的。进度在右上角「任务」里，每台的结果在任务页。</Typography>
            <MuiLink component={Link} href={`/tasks/${taskId}`} onClick={onLeave}>
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
            {sources.length ? (
              <Box>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    部件
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {partial ? `${kinds.length}/${COLLECT_KINDS.length}` : "全部"}
                  </Typography>
                  <Button size="small" onClick={() => setKinds(COLLECT_KINDS)}>
                    全选
                  </Button>
                  <Button size="small" onClick={() => setKinds([])}>
                    清空
                  </Button>
                </Stack>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" } }}>
                  {COLLECT_KINDS.map((kind) => (
                    <FormControlLabel
                      key={kind}
                      sx={{ mr: 0 }}
                      control={<Checkbox size="small" checked={kinds.includes(kind)} onChange={() => setKinds((list) => (list.includes(kind) ? list.filter((item) => item !== kind) : COLLECT_KINDS.filter((item) => item === kind || list.includes(item))))} />}
                      label={
                        <Typography variant="body2">
                          {KIND_LABEL[kind]}
                          {COLLECT_KIND_ONLY[kind] ? (
                            <Box component="span" sx={{ color: "text.secondary" }}>{`（仅${SOURCE_LABEL[COLLECT_KIND_ONLY[kind]!]}）`}</Box>
                          ) : null}
                        </Typography>
                      }
                    />
                  ))}
                </Box>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                  {partial
                    ? "只采勾上的类别，没勾的保留上次采集的结果；BMC 只读这几类要的 Redfish 资源，比全采快。整机、主板信息每次都会顺带更新。"
                    : "全采。只想更新某几类（比如换了 GPU、加了硬盘）时，只勾那几类。"}
                  {unreadable.length ? ` ${unreadable.map((kind) => KIND_LABEL[kind]).join("、")}在没勾的那一边才读得到，这次读不到。` : ""}
                </Typography>
              </Box>
            ) : null}
            <Stack direction="row" spacing={2}>
              {(["overview", "bios", "firmware"] as const).map((value) => (
                <FormControlLabel
                  key={value}
                  control={<Checkbox checked={settings.includes(value)} onChange={() => setSettings((list) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]))} />}
                  label={BMC_SETTING_LABEL[value]}
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
              BMC 采集每台要一两分钟（BMC 一次只处理一个请求），多台同时跑互不影响。系统内采集要能用控制台的密钥 SSH 登录。BMC 设置是引导、定位灯、虚拟介质这些概况，BIOS 设置是全部设置项，固件版本是 BMC、BIOS、CPLD 和 HGX 底板（GPU、NVSwitch、HMC 等）的版本，每台多十几秒。读完在侧边栏 BMC、BIOS 页和「固件版本」页能看到，BIOS 和固件和上次读的比有变化会列在任务结果里。
              {skipped ? ` 其中 ${skipped} 台不是服务器，跳过。` : ""}
              {noBmc && (sources.includes("bmc") || settings.length) ? ` 有 ${noBmc} 台没有 BMC 地址，只能采系统内的。` : ""}
            </Typography>
            {error ? (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            ) : null}
            <Box>
              <Button variant="contained" disabled={pending || (!sources.length && !settings.length) || (sources.length > 0 && !kinds.length) || !servers.length} onClick={() => void start()}>
                {pending ? "正在发起" : sources.length ? `开始采集 ${servers.length} 台` : `开始读取 ${servers.length} 台`}
              </Button>
            </Box>
          </Stack>
        );
}
