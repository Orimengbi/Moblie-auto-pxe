"use client";

import { useState } from "react";
import { AssetHistory } from "@/components/asset-history";
import { AssetOverview } from "@/components/asset-overview";
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
  /** 标题后面的一行说明。 */
  description: string;
}

type Tab = "overview" | "hardware" | "changes" | "ports" | "topology" | "optics" | "history";

const TABS: [Tab, string][] = [
  ["overview", "概况"],
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
                {TABS.map(([value, label]) => (
                  <Button key={value} type="button" size="sm" variant={tab === value ? "default" : "ghost"} onClick={() => setTab(value)}>
                    {label}
                  </Button>
                ))}
              </div>
            </SheetHeader>
            <SheetBody>
              {tab === "overview" ? <AssetOverview key={row.id} assetId={row.id} onChanged={onChanged} /> : null}
              {tab === "hardware" ? <ServerInventory key={row.id} projectId={projectId} row={row} /> : null}
              {tab === "changes" ? <ServerChanges key={row.id} row={row} /> : null}
              {tab === "ports" ? <ServerPorts key={row.id} row={row} /> : null}
              {tab === "topology" ? <ServerTopology key={row.id} row={row} /> : null}
              {tab === "optics" ? <ServerOptics key={row.id} row={row} /> : null}
              {tab === "history" ? <AssetHistory key={row.id} assetId={row.id} /> : null}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
