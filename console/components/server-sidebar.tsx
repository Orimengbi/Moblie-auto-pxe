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

/** 网络设备只有这几页：服务器的硬件、接口、拓扑、光模块页对它没意义。 */
const NETWORK_TABS: Tab[] = ["overview", "netports", "changes", "monitor", "tickets", "history"];

const TABS: [Tab, string][] = [
  ["netports", "端口"],
  ["overview", "概况"],
  ["monitor", "监控"],
  ["tickets", "工单"],
  ["hardware", "硬件配置"],
  ["changes", "变更记录"],
  ["ports", "接口"],
  ["topology", "GPU / 网卡拓扑"],
  ["optics", "光模块"],
  ["history", "记录"],
];

/**
 * 点资产列表或装机批次里的一行，从右边滑出这台资产的侧边栏。点外面关闭；点到列表里别的行不关，直接换成那一台。
 * 从装机批次打开时带 projectId，硬件配置按那个批次的基准检查。
 */
export function ServerSidebar({ projectId, row, initialTab = "overview", onClose, onChanged }: { projectId?: string; row: Row | null; initialTab?: Tab; onClose: () => void; onChanged?: () => void }) {
  // 换一台机器时停在同一个标签上，方便一台台对比。
  const [tab, setTab] = useState<Tab>(initialTab);
  const network = Boolean(row?.type && row.type !== "server");
  const tabs = TABS.filter(([value]) => (network ? NETWORK_TABS.includes(value) : value !== "netports"));
  const current = tabs.some(([value]) => value === tab) ? tab : "overview";
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
                {tabs.map(([value, label]) => (
                  <Button key={value} type="button" size="sm" variant={current === value ? "default" : "ghost"} onClick={() => setTab(value)}>
                    {label}
                  </Button>
                ))}
              </div>
            </SheetHeader>
            <SheetBody>
              {current === "netports" ? <NetworkDevice key={row.id} assetId={row.id} /> : null}
              {current === "overview" ? <AssetOverview key={row.id} assetId={row.id} onChanged={onChanged} /> : null}
              {current === "monitor" ? <AssetMonitor key={row.id} assetId={row.id} /> : null}
              {current === "tickets" ? <AssetTickets key={row.id} asset={{ id: row.id, tag: row.tag || row.sn, sn: row.sn, model: "" }} onChanged={onChanged} /> : null}
              {current === "hardware" ? <ServerInventory key={row.id} projectId={projectId} row={row} /> : null}
              {current === "changes" ? <ServerChanges key={row.id} row={row} /> : null}
              {current === "ports" ? <ServerPorts key={row.id} row={row} /> : null}
              {current === "topology" ? <ServerTopology key={row.id} row={row} /> : null}
              {current === "optics" ? <ServerOptics key={row.id} row={row} /> : null}
              {current === "history" ? <AssetHistory key={row.id} assetId={row.id} /> : null}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
