"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Portal from "@mui/material/Portal";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import { AssetHistory } from "@/components/asset-history";
import { AssetMonitor } from "@/components/asset-monitor";
import { AssetOverview } from "@/components/asset-overview";
import { AssetTickets } from "@/components/asset-tickets";
import { NetworkDevice } from "@/components/network-device";
import { ServerBios } from "@/components/server-bios";
import { ServerBmc } from "@/components/server-bmc";
import { ServerBmcLogs } from "@/components/server-bmc-logs";
import { ServerChanges } from "@/components/server-changes";
import { ServerInventory } from "@/components/server-inventory";
import { ServerOptics } from "@/components/server-optics";
import { ServerPorts } from "@/components/server-ports";
import { ServerTopology } from "@/components/server-topology";

interface Row {
  /** 资产 id。 */
  id: string;
  sn: string;
  /** 资产编号，新建工单时显示。 */
  tag?: string;
  /** 资产类型。不是服务器时换成网络设备的标签页。 */
  type?: string;
  /** 标题后面的一行说明。 */
  description: string;
}

type Tab = "overview" | "netports" | "monitor" | "bmc" | "bios" | "bmclogs" | "tickets" | "hardware" | "changes" | "ports" | "topology" | "optics" | "history";

interface TabContext {
  row: Row;
  projectId?: string;
  onChanged?: () => void;
}

/**
 * 每页的名字、给谁看、显示什么。where：server 只给服务器，network 只给网络设备，all 都有。
 * 按这个顺序显示标签。
 */
const TABS: { id: Tab; label: string; where: "server" | "network" | "all"; render: (context: TabContext) => React.ReactNode }[] = [
  { id: "netports", label: "端口", where: "network", render: ({ row }) => <NetworkDevice assetId={row.id} /> },
  { id: "overview", label: "概况", where: "all", render: ({ row, onChanged }) => <AssetOverview assetId={row.id} onChanged={onChanged} /> },
  { id: "monitor", label: "监控", where: "all", render: ({ row }) => <AssetMonitor assetId={row.id} /> },
  { id: "bmc", label: "BMC", where: "server", render: ({ row }) => <ServerBmc assetId={row.id} /> },
  { id: "bios", label: "BIOS", where: "server", render: ({ row }) => <ServerBios assetId={row.id} /> },
  { id: "bmclogs", label: "BMC 日志", where: "server", render: ({ row }) => <ServerBmcLogs assetId={row.id} /> },
  { id: "tickets", label: "工单", where: "all", render: ({ row, onChanged }) => <AssetTickets asset={{ id: row.id, tag: row.tag || row.sn, sn: row.sn, model: "" }} onChanged={onChanged} /> },
  { id: "hardware", label: "硬件配置", where: "server", render: ({ row, projectId }) => <ServerInventory projectId={projectId} row={row} /> },
  { id: "changes", label: "变更记录", where: "all", render: ({ row }) => <ServerChanges row={row} /> },
  { id: "ports", label: "接口", where: "server", render: ({ row }) => <ServerPorts row={row} /> },
  { id: "topology", label: "GPU / 网卡拓扑", where: "server", render: ({ row }) => <ServerTopology row={row} /> },
  { id: "optics", label: "光模块", where: "server", render: ({ row }) => <ServerOptics row={row} /> },
  { id: "history", label: "记录", where: "all", render: ({ row }) => <AssetHistory assetId={row.id} /> },
];

/** 点在这些地方不算“点外面”：列表里的行（直接换台），和弹在上面的对话框、菜单。 */
function keepsOpen(target: EventTarget | null): boolean {
  return Boolean((target as Element | null)?.closest?.("[data-server-row], .MuiModal-root, .MuiPopover-root, .MuiPopper-root"));
}

/**
 * 点资产列表或装机批次里的一行，从右边滑出这台资产的侧边栏。不加遮罩，页面照常能点；
 * 点外面、按 Esc 或右上角关闭；点到列表里别的行不关，直接换成那一台。
 * 从装机批次打开时带 projectId，硬件配置按那个批次的基准检查。
 */
/** 标题序列号旁边的小字：最近一次硬件采集里的 BIOS 和 BMC 版本。没采集过就不显示。 */
function FirmwareVersions({ assetId }: { assetId: string }) {
  const [versions, setVersions] = useState<{ bios: string; bmc: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const response = await fetch(`/api/assets/${assetId}/inventory?view=firmware`).catch(() => null);
      const body = response?.ok ? await response.json().catch(() => null) : null;
      if (alive) setVersions(body);
    };
    void load();
    const onUpdated = (event: Event) => {
      if ((event as CustomEvent<string>).detail === assetId) void load();
    };
    window.addEventListener("pxe:inventory-updated", onUpdated);
    return () => {
      alive = false;
      window.removeEventListener("pxe:inventory-updated", onUpdated);
    };
  }, [assetId]);
  const parts = [versions?.bios && `BIOS ${versions.bios}`, versions?.bmc && `BMC ${versions.bmc}`].filter(Boolean);
  if (!parts.length) return null;
  return (
    <Typography component="span" variant="caption" sx={{ color: "text.secondary", fontFamily: "var(--font-geist-mono), monospace", whiteSpace: "nowrap" }}>
      {parts.join(" · ")}
    </Typography>
  );
}

export function ServerSidebar({ projectId, row, initialTab = "overview", onClose, onChanged }: { projectId?: string; row: Row | null; initialTab?: Tab; onClose: () => void; onChanged?: () => void }) {
  // 换一台机器时停在同一个标签上，方便一台台对比。
  const [tab, setTab] = useState<Tab>(initialTab);
  const network = Boolean(row?.type && row.type !== "server");
  const tabs = TABS.filter((item) => item.where === "all" || item.where === (network ? "network" : "server"));
  const current = tabs.find((item) => item.id === tab) || tabs.find((item) => item.id === "overview")!;
  const open = Boolean(row);

  // 没有遮罩就没有 Modal 自带的 Esc，自己听；对话框里按 Esc 只关对话框。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || keepsOpen(event.target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 放到 body 下，不占调用方的版面（停靠式 Drawer 会留一个空的外层节点）。
  return (
    <Portal>
      <Drawer
        anchor="right"
        variant="persistent"
        open={open}
        slotProps={{
          paper: {
            sx: { zIndex: (theme) => theme.zIndex.drawer + 1, width: { xs: "100%", sm: "min(56rem, 92vw)" }, boxShadow: 8 },
          },
        }}
      >
        {row ? (
          <ClickAwayListener
            onClickAway={(event) => {
              if (keepsOpen(event.target)) return;
              onClose();
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
              <Box sx={{ position: "relative", px: 2.5, pt: 2, pr: 6, borderBottom: 1, borderColor: "divider" }}>
                <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 1.5, rowGap: 0.25 }}>
                  <Typography variant="h3" sx={{ fontFamily: "var(--font-geist-mono), monospace", wordBreak: "break-all" }}>
                    {row.sn}
                  </Typography>
                  {network ? null : <FirmwareVersions key={row.id} assetId={row.id} />}
                </Box>
                <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
                  {row.description}
                </Typography>
                <Tooltip title="关闭">
                  <IconButton aria-label="关闭" onClick={onClose} sx={{ position: "absolute", top: 12, right: 12 }}>
                    <CloseOutlined fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tabs
                  value={current.id}
                  onChange={(_, next: Tab) => setTab(next)}
                  variant="scrollable"
                  scrollButtons="auto"
                  allowScrollButtonsMobile
                  sx={{ mt: 1, minHeight: 40, "& .MuiTab-root": { minHeight: 40, px: 1.5, minWidth: 0 } }}
                >
                  {tabs.map((item) => (
                    <Tab key={item.id} value={item.id} label={item.label} />
                  ))}
                </Tabs>
              </Box>
              {/* 换台时用 key 让这一页重新挂载、重新读数据。 */}
              <Box key={`${row.id}-${current.id}`} sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2.5, py: 2, display: "flex", flexDirection: "column", gap: 2 }}>
                {current.render({ row, projectId, onChanged })}
              </Box>
            </Box>
          </ClickAwayListener>
        ) : null}
      </Drawer>
    </Portal>
  );
}
