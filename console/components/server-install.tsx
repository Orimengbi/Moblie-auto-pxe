"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { StatusChip } from "@/components/mui/status-chip";
import { useCan } from "@/components/role-context";
import type { Tone } from "@/lib/asset-labels";
import { api } from "@/lib/client-api";
import type { ServerRow } from "@/lib/types";
import { formatTime } from "@/lib/time";

type PublicRow = Omit<ServerRow, "originalPassword" | "targetPassword">;

interface InstallInfo {
  project: { id: string; name: string; enabled: boolean; hasDhcp: boolean };
  profiles: string[];
  otherEnabled: { id: string; name: string } | null;
  row: PublicRow | null;
  defaults: { osAddress: string; osNetmask: string; osGateway: string; osDns: string; osNic: string };
}

/** 装机进行中时隔多久对一次账、刷新进度。和批次页一样。 */
const POLL_MS = 30000;

const STAGE: Record<PublicRow["stage"], string> = {
  waiting: "等待",
  ready: "已让它从网卡启动",
  installing: "安装中",
  error: "出错",
};

function stageLabel(row: PublicRow): string {
  return row.installed === "yes" ? "已安装" : STAGE[row.stage];
}

function stageTone(row: PublicRow): Tone {
  return row.installed === "yes" ? "success" : row.stage === "error" ? "error" : row.stage === "installing" ? "primary" : "neutral";
}

/**
 * 单台装机：BMC 已经配好的服务器，选个系统就装，不用建批次、填服务器表。
 * 用常驻的「单台装机」批次：DHCP 和安装设置在那个批次里写一次。点「装机」会打开它的开关，
 * 由控制台用资产上的 BMC 账号让这台从网卡启动，之后和批量装机一样按序列号装。
 */
export function ServerInstall({ assetId }: { assetId: string }) {
  const canInstall = useCan("install");
  const [info, setInfo] = useState<InstallInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [osName, setOsName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [address, setAddress] = useState("");
  const [netmask, setNetmask] = useState("");
  const [gateway, setGateway] = useState("");
  const [dns, setDns] = useState("");
  const [nic, setNic] = useState("");
  const [customization, setCustomization] = useState("");

  const load = useCallback(async () => {
    const result = await api<InstallInfo>(`/api/assets/${assetId}/install`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInfo(result.data);
    setOsName((current) => current || result.data.row?.osName || result.data.profiles[0] || "");
  }, [assetId]);

  // 表单只在第一次读到时填默认值，之后定时刷新进度不能冲掉正在填的内容。
  useEffect(() => {
    if (!info || loaded) return;
    setLoaded(true);
    setAddress(info.defaults.osAddress);
    setNetmask(info.defaults.osNetmask);
    setGateway(info.defaults.osGateway);
    setDns(info.defaults.osDns);
    setNic(info.defaults.osNic);
  }, [info, loaded]);

  useEffect(() => {
    void load();
  }, [load]);

  // 装机进行中：像批次页一样定时对账（让 BMC 从网卡启动、记下 IPMI 状态），再读一次进度。
  const running = Boolean(info?.project.enabled && info.row && info.row.installed !== "yes" && info.row.stage !== "error");
  useEffect(() => {
    if (!running || !canInstall || !info) return;
    const projectId = info.project.id;
    const timer = setInterval(() => {
      void fetch(`/api/projects/${projectId}/reconcile`, { method: "POST" })
        .catch(() => null)
        .then(() => load());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, canInstall, info, load]);

  async function install() {
    const again = info?.row?.installed === "yes" || info?.row?.stage === "installing";
    const prompt = `让这台从网卡启动并安装「${osName}」？${again ? "这台装过，会重装，" : ""}硬盘上的数据会被覆盖（内存运行的系统除外）。服务器会马上重启。`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    const result = await api<{ row: PublicRow | null }>(`/api/assets/${assetId}/install`, "POST", {
      osName,
      osAddress: address,
      osNetmask: netmask,
      osGateway: gateway,
      osDns: dns,
      osNic: nic,
      customization,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    await load();
  }

  if (!info) {
    return error ? (
      <Typography variant="body2" color="error">
        {error}
      </Typography>
    ) : null;
  }
  const projectLink = (
    <Link component={NextLink} href={`/projects/${info.project.id}`}>
      「{info.project.name}」批次
    </Link>
  );
  const notReady = !info.project.hasDhcp || !info.profiles.length;
  const row = info.row;

  return (
    <Stack spacing={2}>
      {row ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              上次单台装机：{row.osName}
            </Typography>
            <StatusChip tone={stageTone(row)} label={stageLabel(row)} />
          </Stack>
          <Typography variant="body2">{row.detail}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {formatTime(row.updatedAt)} 更新{running ? `，打开这一页时每 ${POLL_MS / 1000} 秒刷新一次` : ""}
          </Typography>
        </Paper>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2">单台装机</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          用资产上的 BMC 地址和账号让这台从网卡启动，按选的系统无人值守安装。不用建批次、填服务器表，也不改 BMC 的网络和账号。服务器的 PXE 网口要接在装机交换机上。
        </Typography>
        {notReady ? (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            先在{projectLink}里{!info.project.hasDhcp ? "写好 DHCP" : ""}
            {!info.project.hasDhcp && !info.profiles.length ? "、" : ""}
            {!info.profiles.length ? "加至少一条安装设置" : ""}，写一次以后每台都能直接用。
          </Alert>
        ) : null}
        {info.otherEnabled ? (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            装机批次{" "}
            <Link component={NextLink} href={`/projects/${info.otherEnabled.id}`}>
              「{info.otherEnabled.name}」
            </Link>{" "}
            正开着，同时只能开一个批次。等它装完、关掉开关后再单台装机。
          </Alert>
        ) : null}
        <Stack spacing={1.5}>
          <TextField select size="small" label="安装系统" value={osName} onChange={(event) => setOsName(event.target.value)} disabled={!info.profiles.length}>
            {info.profiles.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField size="small" label="系统地址" placeholder="不填就不改系统网络" value={address} onChange={(event) => setAddress(event.target.value)} sx={{ flex: 1 }} />
            <TextField size="small" label="掩码" placeholder="24 或 255.255.255.0" value={netmask} onChange={(event) => setNetmask(event.target.value)} sx={{ flex: 1 }} />
          </Stack>
          {address ? (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField size="small" label="网关" value={gateway} onChange={(event) => setGateway(event.target.value)} sx={{ flex: 1 }} />
              <TextField size="small" label="DNS" placeholder="多个用逗号分开" value={dns} onChange={(event) => setDns(event.target.value)} sx={{ flex: 1 }} />
              <TextField size="small" label="系统网卡" placeholder="接口名或 MAC，留空自动挑" value={nic} onChange={(event) => setNic(event.target.value)} sx={{ flex: 1 }} />
            </Stack>
          ) : null}
          <TextField size="small" label="定制需求" placeholder="附加到安装后脚本，可以不填" multiline minRows={2} value={customization} onChange={(event) => setCustomization(event.target.value)} />
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button variant="contained" disabled={!canInstall || busy || notReady || Boolean(info.otherEnabled) || !osName} onClick={() => void install()}>
              {busy ? "正在让它从网卡启动…" : row ? "重新装机" : "装机"}
            </Button>
            {!canInstall ? (
              <Typography variant="caption" color="text.secondary">
                需要「PXE 装机」权限
              </Typography>
            ) : null}
          </Stack>
          {info.project.enabled ? (
            <Typography variant="caption" color="text.secondary">
              {projectLink}的开关开着，装机网上在发 DHCP。都装完了可以去批次页关掉。
            </Typography>
          ) : null}
        </Stack>
      </Paper>
    </Stack>
  );
}
