"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * 页面内的远程控制台：全屏浮层里嵌 BMC 的 H5Viewer（经 /__bmc/ 代理，和控制台同源）。
 * 关掉浮层就断开 KVM。
 */
export function RemoteConsole({
  projectId,
  row,
  port,
  onClose,
}: {
  projectId: string;
  row: { id: string; sn: string; bmcIp?: string };
  port: string;
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const path = `/__bmc/${projectId}/${row.id}/viewer.html`;
  const src = typeof window !== "undefined" && port ? `${window.location.protocol}//${window.location.hostname}:${port}${path}` : path;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 键盘输入要给 KVM，只有焦点不在画面里时 Esc 才关闭。
      if (event.key === "Escape" && document.activeElement !== frame.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-label={`${row.sn} 远程控制台`}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span className="font-medium">远程控制台</span>
        <span className="font-mono text-sm">{row.sn}</span>
        <span className="text-sm text-muted-foreground">BMC {row.bmcIp}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => frame.current?.contentWindow?.location.reload()}>
            重新连接
          </Button>
          <Button size="sm" variant="outline" onClick={() => void frame.current?.requestFullscreen?.()}>
            全屏
          </Button>
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
      <iframe ref={frame} src={src} title={`${row.sn} 远程控制台`} className="w-full flex-1 border-0 bg-black" allow="fullscreen; clipboard-read; clipboard-write" />
    </div>
  );
}
