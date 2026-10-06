"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

/** 文本列填关键字；选项列勾选要看的值。 */
export type ColumnFilter = { kind: "text"; value: string } | { kind: "pick"; value: string[] };

/** 表头：点名字排序（升序、降序、取消），点漏斗筛选。 */
export function ColumnHead({
  label,
  columnKey,
  sort,
  onSort,
  filter,
  onFilter,
  options,
}: {
  label: string;
  columnKey: string;
  sort: SortState | null;
  onSort: (next: SortState | null) => void;
  filter: ColumnFilter | undefined;
  onFilter: (next: ColumnFilter | undefined) => void;
  /** 有就是选项筛选，没有就是关键字筛选。[值, 这个值有几台] */
  options?: [string, number][];
}) {
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dir = sort?.key === columnKey ? sort.dir : null;
  const active = filter ? (filter.kind === "text" ? filter.value.trim() !== "" : filter.value.length > 0) : false;

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    const onMove = () => setOpen(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  function cycleSort() {
    if (dir === null) onSort({ key: columnKey, dir: "asc" });
    else if (dir === "asc") onSort({ key: columnKey, dir: "desc" });
    else onSort(null);
  }

  function toggleOpen() {
    if (open) {
      setOpen(null);
      return;
    }
    const rect = button.current!.getBoundingClientRect();
    // 表格外面套着横向滚动，用 fixed 定位才不会被裁掉。
    setOpen({ left: Math.min(rect.left, window.innerWidth - 232), top: rect.bottom + 4 });
  }

  const SortIcon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  const picked = filter?.kind === "pick" ? filter.value : [];

  return (
    <div className="flex items-center gap-0.5 whitespace-nowrap">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted"
        title={dir === "asc" ? "升序，再点降序" : dir === "desc" ? "降序，再点取消排序" : "点一下按这列排序"}
        onClick={cycleSort}
      >
        {label}
        <SortIcon className={`size-3 ${dir ? "text-foreground" : "text-muted-foreground/50"}`} />
      </button>
      <button
        ref={button}
        type="button"
        aria-label={`筛选${label}`}
        className={`rounded p-1 hover:bg-muted ${active ? "text-primary" : "text-muted-foreground/50"}`}
        onClick={toggleOpen}
      >
        <Filter className={`size-3 ${active ? "fill-current" : ""}`} />
      </button>
      {open ? (
        <div
          ref={panel}
          className="fixed z-50 grid w-56 gap-2 rounded-lg bg-popover p-2 text-sm font-normal text-popover-foreground shadow-md ring-1 ring-foreground/10"
          style={{ left: open.left, top: open.top }}
        >
          {options ? (
            <>
              <div className="max-h-64 overflow-y-auto">
                {options.map(([value, count]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={picked.includes(value)}
                      onChange={() => {
                        const next = picked.includes(value) ? picked.filter((item) => item !== value) : [...picked, value];
                        onFilter(next.length ? { kind: "pick", value: next } : undefined);
                      }}
                    />
                    <span className="flex-1">{value}</span>
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </label>
                ))}
                {options.length === 0 ? <p className="px-1.5 py-1 text-xs text-muted-foreground">没有可选的值</p> : null}
              </div>
            </>
          ) : (
            <Input
              autoFocus
              value={filter?.kind === "text" ? filter.value : ""}
              placeholder={`${label}包含…`}
              onChange={(event) => onFilter(event.target.value ? { kind: "text", value: event.target.value } : undefined)}
            />
          )}
          <div className="flex justify-between">
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" disabled={!active} onClick={() => onFilter(undefined)}>
              清除筛选
            </button>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(null)}>
              完成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
