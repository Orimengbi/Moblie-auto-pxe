"use client";

import { useState } from "react";
import { ServerChanges } from "@/components/server-changes";
import { ServerInventory } from "@/components/server-inventory";
import { ServerOptics } from "@/components/server-optics";
import { ServerPorts } from "@/components/server-ports";
import { ServerTopology } from "@/components/server-topology";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Row {
  id: string;
  sn: string;
  bmcIp?: string;
  host: string;
  osName: string;
  detail: string;
}

/** 点服务器列表里的一行，从右边滑出这台机器的侧边栏。点外面关闭；点到列表里别的行不关，直接换成那一台。 */
export function ServerSidebar({ projectId, row, onClose }: { projectId: string; row: Row | null; onClose: () => void }) {
  // 换一台机器时停在同一个标签上，方便一台台对比。
  const [tab, setTab] = useState<"hardware" | "changes" | "ports" | "topology" | "optics">("hardware");
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
              <SheetDescription>
                {[row.detail, row.bmcIp && `BMC ${row.bmcIp}`, row.host && `系统 ${row.host}`, row.osName && `安装系统 ${row.osName}`].filter(Boolean).join(" · ")}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button type="button" size="sm" variant={tab === "hardware" ? "default" : "ghost"} onClick={() => setTab("hardware")}>
                  硬件配置
                </Button>
                <Button type="button" size="sm" variant={tab === "changes" ? "default" : "ghost"} onClick={() => setTab("changes")}>
                  变更记录
                </Button>
                <Button type="button" size="sm" variant={tab === "ports" ? "default" : "ghost"} onClick={() => setTab("ports")}>
                  接口
                </Button>
                <Button type="button" size="sm" variant={tab === "topology" ? "default" : "ghost"} onClick={() => setTab("topology")}>
                  GPU / 网卡拓扑
                </Button>
                <Button type="button" size="sm" variant={tab === "optics" ? "default" : "ghost"} onClick={() => setTab("optics")}>
                  光模块
                </Button>
              </div>
            </SheetHeader>
            <SheetBody>
              {tab === "hardware" ? <ServerInventory key={row.id} projectId={projectId} row={row} /> : null}
              {tab === "changes" ? <ServerChanges key={row.id} projectId={projectId} row={row} /> : null}
              {tab === "ports" ? <ServerPorts key={row.id} projectId={projectId} row={row} /> : null}
              {tab === "topology" ? <ServerTopology key={row.id} projectId={projectId} row={row} /> : null}
              {tab === "optics" ? <ServerOptics key={row.id} projectId={projectId} row={row} /> : null}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
