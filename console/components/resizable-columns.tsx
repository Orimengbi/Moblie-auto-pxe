"use client";

import { useEffect, useRef, useState } from "react";

const MIN_WIDTH = 40;
/** 没记过宽度的新列先给这么宽。 */
const FALLBACK_WIDTH = 120;

/**
 * 表格列宽可以拖动调整，存在这个浏览器里。没拖过时按内容自动排；拖过以后整张表按记下的宽度固定排，
 * 放不下的内容换行。用同一个 storageKey 的几张表共用一套宽度。
 * 表头每个 th 要带 data-col（列的 key），拖动的手柄用 ResizeHandle。
 */
export function useColumnWidths(storageKey: string, columns: string[]) {
  const [widths, setWidths] = useState<Record<string, number> | null>(null);
  const latest = useRef<Record<string, number> | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && typeof saved === "object") setWidths(saved);
    } catch {
      // 读不到就按内容自动排。
    }
  }, [storageKey]);

  function save(next: Record<string, number> | null) {
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
    } catch {
      // 存不了也照样能拖，只是刷新后要重来。
    }
  }

  function startResize(key: string, event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const table = event.currentTarget.closest("table");
    if (!table) return;
    // 第一次拖时把现在每列的实际宽度记下来，之后整张表按这些宽度排。
    const start: Record<string, number> = { ...(widths || {}) };
    table.querySelectorAll<HTMLElement>("thead th[data-col]").forEach((th) => {
      const col = th.dataset.col;
      if (col && !(widths && col in widths)) start[col] = Math.round(th.getBoundingClientRect().width);
    });
    const startX = event.clientX;
    const startWidth = start[key] ?? FALLBACK_WIDTH;
    latest.current = start;
    setWidths(start);
    const move = (e: PointerEvent) => {
      latest.current = { ...start, [key]: Math.max(MIN_WIDTH, Math.round(startWidth + e.clientX - startX)) };
      setWidths(latest.current);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      save(latest.current);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function reset() {
    setWidths(null);
    save(null);
  }

  const widthOf = (key: string) => (widths ? (widths[key] ?? FALLBACK_WIDTH) : undefined);
  return {
    /** 给 Table 的 className：固定宽度后单元格内容换行，不挤到旁边的列。 */
    tableClassName: widths ? "table-fixed [&_td]:overflow-hidden [&_td]:break-words [&_td]:whitespace-normal" : "",
    tableStyle: widths ? { width: columns.reduce((sum, key) => sum + (widthOf(key) || 0), 0) } : undefined,
    /** 给每个 th 的 style。 */
    headStyle: (key: string) => (widths ? { width: widthOf(key) } : undefined),
    startResize,
    reset,
  };
}

/** 表头右边缘的拖动手柄。th 要是 relative。双击恢复这张表的默认列宽。 */
export function ResizeHandle({ onStart, onReset }: { onStart: (event: React.PointerEvent<HTMLElement>) => void; onReset: () => void }) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      title="拖动调整列宽，双击恢复默认"
      className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none select-none after:absolute after:top-1/4 after:left-1/2 after:h-1/2 after:w-px after:bg-border hover:after:bg-foreground/40"
      onPointerDown={onStart}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onReset();
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
