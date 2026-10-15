"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { DataGrid, type DataGridProps, type GridValidRowModel } from "@mui/x-data-grid";

/**
 * 列表页的表格：按内容撑开高度，上下只用浏览器自己的滚动条，不在表格里再套一个（用户嫌两个滚动条叠着费劲）。
 * 列多、要左右滚时，表格自己的横向滚动条在最底下够不着，所以另放一条贴在窗口底部（position: sticky），
 * 和表格的滚动位置互相同步；表格整个滚过去以后它回到表格下面。每页最多 100 行，翻页在表格底下。
 */
export function ScrollGrid<R extends GridValidRowModel>({ sx, ...props }: DataGridProps<R>) {
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ content: 0, view: 0 });

  const scroller = useCallback(() => box.current?.querySelector<HTMLElement>(".MuiDataGrid-virtualScroller") || null, []);

  useEffect(() => {
    const root = box.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const s = scroller();
        if (!s) return;
        const next = { content: s.scrollWidth, view: s.clientWidth };
        setSize((prev) => (prev.content === next.content && prev.view === next.view ? prev : next));
      });
    };
    // 表格滚了（拖表头、Shift+滚轮、键盘）就带着下面这条一起动。
    const follow = (event: Event) => {
      const s = scroller();
      if (s && event.target === s && bar.current && bar.current.scrollLeft !== s.scrollLeft) bar.current.scrollLeft = s.scrollLeft;
    };
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    // 列显示/隐藏、改列宽会改内容宽度，不改外框大小。
    const mutate = new MutationObserver(measure);
    mutate.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    root.addEventListener("scroll", follow, true);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutate.disconnect();
      root.removeEventListener("scroll", follow, true);
    };
  }, [scroller]);

  const overflow = size.content > size.view + 1;

  return (
    <Box ref={box} sx={{ width: "100%", minWidth: 0 }}>
      <DataGrid
        autoHeight
        {...props}
        // 有了底下这条，表格自己的横向滚动条就不显示了（它还在，只是看不见，位置照样同步）。
        sx={[overflow ? { "& .MuiDataGrid-scrollbar--horizontal": { opacity: 0, pointerEvents: "none" } } : {}, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      />
      {overflow ? (
        <Box
          ref={bar}
          aria-hidden
          onScroll={() => {
            const s = scroller();
            if (s && bar.current && s.scrollLeft !== bar.current.scrollLeft) s.scrollLeft = bar.current.scrollLeft;
          }}
          // 自己画滚动条：macOS 默认的滚动条平时是隐藏的，贴底这条要一直看得见。
          sx={{
            position: "sticky",
            bottom: 0,
            zIndex: 3,
            overflowX: "auto",
            overflowY: "hidden",
            bgcolor: "background.default",
            "&::-webkit-scrollbar": { height: 12 },
            "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
            "&::-webkit-scrollbar-thumb": { bgcolor: "text.disabled", borderRadius: 6, border: "3px solid transparent", backgroundClip: "content-box" },
            "&::-webkit-scrollbar-thumb:hover": { bgcolor: "text.secondary" },
          }}
        >
          {/* 两边可滚的距离一样（内容宽 - 可见宽），滚动位置才能一一对应。 */}
          <Box sx={{ width: `calc(100% + ${size.content - size.view}px)`, height: "1px" }} />
        </Box>
      ) : null}
    </Box>
  );
}
