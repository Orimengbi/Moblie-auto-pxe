"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import DragIndicatorOutlined from "@mui/icons-material/DragIndicatorOutlined";
import { moveKey } from "@/lib/sortable";

/** 长按多久算拖（毫秒）；按下后先挪了这么多像素就当是在滚动，不拖。 */
const HOLD_MS = 250;
const SLOP_PX = 6;

export interface SortableItem {
  key: string;
  content: ReactNode;
}


/**
 * 能拖着排序的列表：在一行上按住一会儿（或者直接按住左边的把手）就能拖，拖的时候其他行实时让位。
 * 用 pointer 事件，鼠标、触屏一样用；把手有焦点时按上下键也能挪。
 * 行里的勾选框、按钮照常点，不会触发拖动。
 */
export function SortableList({ items, onChange }: { items: SortableItem[]; onChange: (keys: string[]) => void }) {
  const rows = useRef(new Map<string, HTMLDivElement>());
  const [dragging, setDragging] = useState<string | null>(null);
  // 刚拖完：松手后浏览器还会补一个 click，不能让它去勾行里的勾选框。
  const dropped = useRef(false);
  const hold = useRef<{ key: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const keys = items.map((item) => item.key);
  // 拖的过程里拿最新的顺序算位置。
  const latest = useRef({ keys, onChange });
  useEffect(() => {
    latest.current = { keys, onChange };
  });

  function cancelHold() {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }

  function start(key: string) {
    cancelHold();
    setDragging(key);
  }

  /** 指针在哪一行的上半截或下半截，算出要放到第几位。 */
  function moveTo(clientY: number, key: string) {
    const order = latest.current.keys.filter((item) => item !== key);
    let to = order.length;
    for (let index = 0; index < order.length; index++) {
      const rect = rows.current.get(order[index])?.getBoundingClientRect();
      if (rect && clientY < rect.top + rect.height / 2) {
        to = index;
        break;
      }
    }
    const next = moveKey(latest.current.keys, key, to);
    if (next.join("\n") !== latest.current.keys.join("\n")) latest.current.onChange(next);
  }

  useEffect(() => cancelHold, []);

  // 拖的过程在整个窗口上跟指针：行重排时 DOM 会挪，挪了的元素收不到后面的指针事件。
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => moveTo(event.clientY, dragging);
    const end = () => {
      dropped.current = true;
      setTimeout(() => (dropped.current = false), 0);
      setDragging(null);
    };
    // 触屏上拖的时候页面别跟着滚。
    const noScroll = (event: TouchEvent) => event.preventDefault();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("touchmove", noScroll, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("touchmove", noScroll);
    };
    // moveTo 读的是 ref 里最新的顺序，不用跟着重挂。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  return (
    <Box sx={{ userSelect: dragging ? "none" : undefined }}>
      {items.map((item, index) => {
        const active = dragging === item.key;
        return (
          <Box
            key={item.key}
            ref={(el: HTMLDivElement | null) => {
              if (el) rows.current.set(item.key, el);
              else rows.current.delete(item.key);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || dragging) return;
              const target = event.target as HTMLElement;
              if (target.closest("[data-drag-handle]")) {
                event.preventDefault();
                start(item.key);
                return;
              }
              if (target.closest("input, button, a, select, textarea")) return;
              hold.current = { key: item.key, x: event.clientX, y: event.clientY, timer: setTimeout(() => start(item.key), HOLD_MS) };
            }}
            onPointerMove={(event) => {
              if (hold.current && !dragging && Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > SLOP_PX) cancelHold();
            }}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            // 拖着的时候不让勾选框收到松手那一下的点击。
            onClickCapture={(event) => {
              if (active || dropped.current) {
                event.stopPropagation();
                event.preventDefault();
              }
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              pr: 1,
              borderRadius: 1,
              cursor: active ? "grabbing" : "grab",
              touchAction: active ? "none" : undefined,
              bgcolor: active ? "action.selected" : undefined,
              boxShadow: active ? 3 : undefined,
              position: "relative",
              zIndex: active ? 1 : undefined,
              transition: "background-color 120ms",
              "&:hover": { bgcolor: active ? "action.selected" : "action.hover" },
            }}
          >
            <Box
              data-drag-handle=""
              role="button"
              tabIndex={0}
              aria-label={`拖动排序，现在第 ${index + 1} 个，按上下键移动`}
              onKeyDown={(event) => {
                const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                if (!step) return;
                event.preventDefault();
                onChange(moveKey(keys, item.key, index + step));
              }}
              sx={{ display: "flex", color: "text.disabled", touchAction: "none", cursor: active ? "grabbing" : "grab", p: 0.5, borderRadius: 1, "&:focus-visible": { outline: 2, outlineColor: "primary.main" } }}
            >
              <DragIndicatorOutlined fontSize="small" />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>{item.content}</Box>
          </Box>
        );
      })}
    </Box>
  );
}
