"use client";

import { useState } from "react";
import { AssetHistory } from "@/components/asset-history";
import { AssetMonitor } from "@/components/asset-monitor";
import { AssetOverview } from "@/components/asset-overview";
import { AssetTickets } from "@/components/asset-tickets";
import { NetworkDevice } from "@/components/network-device";
import { ServerChanges } from "@/components/server-changes";
import { ServerInventory } from "@/components/server-inventory";
import { ServerOptics } from "@/components/server-optics";
import { ServerPorts } from "@/components/server-ports";
import { ServerTopology } from "@/components/server-topology";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

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

type Tab = "overview" | "netports" | "monitor" | "tickets" | "hardware" | "changes" | "ports" | "topology" | "optics" | "history";

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
  { id: "tickets", label: "工单", where: "all", render: ({ row, onChanged }) => <AssetTickets asset={{ id: row.id, tag: row.tag || row.sn, sn: row.sn, model: "" }} onChanged={onChanged} /> },
  { id: "hardware", label: "硬件配置", where: "server", render: ({ row, projectId }) => <ServerInventory projectId={projectId} row={row} /> },
  { id: "changes", label: "变更记录", where: "all", render: ({ row }) => <ServerChanges row={row} /> },
  { id: "ports", label: "接口", where: "server", render: ({ row }) => <ServerPorts row={row} /> },
  { id: "topology", label: "GPU / 网卡拓扑", where: "server", render: ({ row }) => <ServerTopology row={row} /> },
  { id: "optics", label: "光模块", where: "server", render: ({ row }) => <ServerOptics row={row} /> },
  { id: "history", label: "记录", where: "all", render: ({ row }) => <AssetHistory assetId={row.id} /> },
];

/**
 * 点资产列表或装机批次里的一行，从右边滑出这台资产的侧边栏。点外面关闭；点到列表里别的行不关，直接换成那一台。
 * 从装机批次打开时带 projectId，硬件配置按那个批次的基准检查。
 */
export function ServerSidebar({ projectId, row, initialTab = "overview", onClose, onChanged }: { projectId?: string; row: Row | null; initialTab?: Tab; onClose: () => void; onChanged?: () => void }) {
  // 换一台机器时停在同一个标签上，方便一台台对比。
  const [tab, setTab] = useState<Tab>(initialTab);
  const network = Boolean(row?.type && row.type !== "server");
  const tabs = TABS.filter((item) => item.where === "all" || item.where === (network ? "network" : "server"));
  const current = tabs.find((item) => item.id === tab) || tabs.find((item) => item.id === "overview")!;
  return (
    <Sheet
      open={Boolean(row)}
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "outside-press" && (details.event.target as Element | null)?.closest?.("[data-server-row]")) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <SheetContent>
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono">{row.sn}</SheetTitle>
              <SheetDescription>{row.description}</SheetDescription>
              <div className="mt-2 flex flex-wrap gap-1">
                {tabs.map((item) => (
                  <Button key={item.id} type="button" size="sm" variant={current.id === item.id ? "default" : "ghost"} onClick={() => setTab(item.id)}>
                    {item.label}
                  </Button>
                ))}
              </div>
            </SheetHeader>
            {/* 换台时用 key 让这一页重新挂载、重新读数据。 */}
            <SheetBody key={`${row.id}-${current.id}`}>{current.render({ row, projectId, onChanged })}</SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
