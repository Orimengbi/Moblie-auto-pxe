"use client";

import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * 页面内的远程控制台：全屏浮层里嵌 BMC 的 H5Viewer（经 /__bmc/ 代理，和控制台同源）。
 * 关掉浮层就断开 KVM。
 */
export function RemoteConsole({
  row,
  port,
  onClose,
}: {
  /** id 是资产 id。 */
  row: { id: string; sn: string; bmcIp?: string };
  port: string;
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const path = `/__bmc/${row.id}/viewer.html`;
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

  // 不用 MUI 的 Dialog：它会抢焦点、拦 Esc，键盘要原样给 KVM。
  return (
    <Box
      role="dialog"
      aria-label={`${row.sn} 远程控制台`}
      sx={{ position: "fixed", inset: 0, zIndex: "modal", display: "flex", flexDirection: "column", bgcolor: "background.default" }}
    >
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", borderBottom: 1, borderColor: "divider", px: 2, py: 1 }}>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          远程控制台
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: "var(--font-geist-mono), monospace" }}>
          {row.sn}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          BMC {row.bmcIp}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
          <Button variant="outlined" onClick={() => frame.current?.contentWindow?.location.reload()}>
            重新连接
          </Button>
          <Button variant="outlined" onClick={() => void frame.current?.requestFullscreen?.()}>
            全屏
          </Button>
          <Button variant="contained" onClick={onClose}>
            关闭
          </Button>
        </Stack>
      </Stack>
      <Box
        component="iframe"
        ref={frame}
        src={src}
        title={`${row.sn} 远程控制台`}
        allow="fullscreen; clipboard-read; clipboard-write"
        sx={{ width: "100%", flex: 1, border: 0, bgcolor: "common.black" }}
      />
    </Box>
  );
}
