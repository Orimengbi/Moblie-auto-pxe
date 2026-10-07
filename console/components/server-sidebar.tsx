"use client";

import { ServerInventory } from "@/components/server-inventory";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Row {
  id: string;
  sn: string;
  bmcIp?: string;
  host: string;
  osName: string;
  detail: string;
}

/** 点服务器列表里的一行，从右边滑出这台机器的侧边栏。不挡列表，点别的行直接换成那一台。 */
export function ServerSidebar({ projectId, row, onClose }: { projectId: string; row: Row | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(row)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent>
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono">{row.sn}</SheetTitle>
              <SheetDescription>
                {[row.detail, row.bmcIp && `BMC ${row.bmcIp}`, row.host && `系统 ${row.host}`, row.osName && `安装系统 ${row.osName}`].filter(Boolean).join(" · ")}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <ServerInventory key={row.id} projectId={projectId} row={row} />
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
