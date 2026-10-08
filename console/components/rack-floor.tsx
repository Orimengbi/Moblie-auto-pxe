"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FLOOR_ITEM_KINDS } from "@/lib/asset-labels";
import type { AssetRow } from "@/lib/asset-view";
import { api } from "@/lib/client-api";
import { floorPositions } from "@/lib/floor";
import type { AlertSeverity, FloorItem, FloorItemKind, Rack, RackFacing } from "@/lib/types";

const CELL_W = 64;
const CELL_H = 44;

/** 斜纹：不可用的机柜和障碍物。 */
const HATCH = "repeating-linear-gradient(45deg, color-mix(in oklab, var(--foreground) 14%, transparent) 0 5px, transparent 5px 10px)";

type Mode = "usage" | "alerts";
type Obstacle = Omit<FloorItem, "siteId">;
type Picked = { type: "rack" | "item"; id: string } | null;

interface RackInfo {
  rack: Rack;
  used: number;
  devices: number;
  alert: AlertSeverity | null;
}

/** 利用率配色：越满越深。没设备是浅灰。 */
function usageStyle(info: RackInfo): React.CSSProperties {
  if (!info.devices) return { background: "var(--muted)" };
  const ratio = Math.min(1, info.used / info.rack.heightU);
  return { background: `color-mix(in oklab, var(--primary) ${Math.round(20 + ratio * 70)}%, var(--background))`, color: ratio > 0.5 ? "var(--primary-foreground)" : undefined };
}

function alertStyle(info: RackInfo): React.CSSProperties {
  if (info.alert === "critical") return { background: "var(--destructive)", color: "white" };
  if (info.alert === "warning") return { background: "color-mix(in oklab, orange 70%, var(--background))" };
  return { background: info.devices ? "color-mix(in oklab, var(--primary) 25%, var(--background))" : "var(--muted)" };
}

function withoutSite(items: FloorItem[]): Obstacle[] {
  return items.map((item) => ({ id: item.id, kind: item.kind, label: item.label, x: item.x, y: item.y, w: item.w, h: item.h }));
}

/**
 * 机房俯视图：每个机柜一格，按利用率或告警上色；柱子、空调、配电柜这类障碍物画成斜纹块，不可用的机柜也是斜纹。
 * 编辑布局时：点一个机柜或障碍物选中，再点空格挪过去（机柜也可以直接拖）；选「放障碍物」后点空格放一个。
 * 都先在页面上改，点「保存布局」才写入。不在编辑时点机柜跳到它的正视图。
 */
export function RackFloor({
  siteId,
  racks,
  obstacles,
  assets,
  alerts,
  onOpenRack,
  onSaved,
}: {
  siteId: string;
  racks: Rack[];
  obstacles: FloorItem[];
  assets: AssetRow[];
  /** 资产 id → 最严重的未恢复告警。 */
  alerts: Record<string, AlertSeverity>;
  onOpenRack: (rackId: string) => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<Mode>("usage");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { x: number; y: number; facing: RackFacing }>>({});
  const [items, setItems] = useState<Obstacle[] | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [tool, setTool] = useState<FloorItemKind | "">("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const savedItems = useMemo(() => withoutSite(obstacles), [obstacles]);
  const currentItems = items ?? savedItems;

  const infos = useMemo(() => {
    const map = new Map<string, RackInfo>();
    for (const rack of racks) map.set(rack.id, { rack, used: 0, devices: 0, alert: null });
    for (const asset of assets) {
      const info = asset.rackId ? map.get(asset.rackId) : undefined;
      if (!info) continue;
      info.devices += 1;
      if (asset.uStart && asset.uHeight > 0) info.used += asset.uHeight;
      const alert = alerts[asset.id];
      if (alert === "critical" || (alert === "warning" && info.alert !== "critical")) info.alert = alert;
    }
    return map;
  }, [racks, assets, alerts]);

  const auto = useMemo(() => floorPositions(racks, currentItems), [racks, currentItems]);
  const position = (rack: Rack) => draft[rack.id] || { ...auto.get(rack.id)!, facing: rack.facing };
  const cells = racks.map((rack) => ({ rack, ...position(rack) }));
  const width = Math.max(8, ...cells.map((cell) => cell.x + 2), ...currentItems.map((item) => item.x + item.w + 1));
  const height = Math.max(4, ...cells.map((cell) => cell.y + 2), ...currentItems.map((item) => item.y + item.h + 1));

  /** 这块区域有没有被占（except 是正在挪的那个自己）。 */
  function occupied(x: number, y: number, w = 1, h = 1, except?: Picked): boolean {
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cells.some((cell) => cell.x === cx && cell.y === cy && !(except?.type === "rack" && except.id === cell.rack.id))) return true;
        if (currentItems.some((item) => !(except?.type === "item" && except.id === item.id) && cx >= item.x && cx < item.x + item.w && cy >= item.y && cy < item.y + item.h)) return true;
      }
    }
    return false;
  }

  function startEdit() {
    setEditing(true);
    setItems(savedItems);
  }

  function stopEdit() {
    setDraft({});
    setItems(null);
    setEditing(false);
    setPicked(null);
    setTool("");
    setError("");
  }

  function updateItem(id: string, patch: Partial<Obstacle>) {
    setItems((list) => (list || []).map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function moveRack(rackId: string, x: number, y: number) {
    const rack = racks.find((item) => item.id === rackId);
    if (!rack) return;
    setDraft((current) => ({ ...current, [rackId]: { x, y, facing: position(rack).facing } }));
  }

  function clickEmpty(x: number, y: number) {
    setError("");
    if (tool) {
      setItems((list) => [...(list || []), { id: `new-${Date.now()}`, kind: tool, label: "", x, y, w: 1, h: 1 }]);
      return;
    }
    if (!picked) return;
    if (picked.type === "rack") moveRack(picked.id, x, y);
    else {
      const item = currentItems.find((entry) => entry.id === picked.id)!;
      if (occupied(x, y, item.w, item.h, picked)) {
        setError("放不下：会压到别的机柜或障碍物");
        return;
      }
      updateItem(picked.id, { x, y });
    }
    setPicked(null);
  }

  function resize(item: Obstacle, dw: number, dh: number) {
    const w = Math.min(20, Math.max(1, item.w + dw));
    const h = Math.min(20, Math.max(1, item.h + dh));
    if (occupied(item.x, item.y, w, h, { type: "item", id: item.id })) {
      setError("变大后会压到别的机柜或障碍物");
      return;
    }
    setError("");
    updateItem(item.id, { w, h });
  }

  function turn(rack: Rack) {
    const now = position(rack);
    const next: RackFacing = now.facing === "" ? "up" : now.facing === "up" ? "down" : "";
    setDraft((current) => ({ ...current, [rack.id]: { x: now.x, y: now.y, facing: next } }));
  }

  async function save(rackItems: { id: string; x: number | null; y: number | null; facing?: RackFacing }[], obstacleItems: Obstacle[]) {
    setSaving(true);
    const result = await api(`/api/sites/${siteId}/layout`, "PUT", { items: rackItems, obstacles: obstacleItems.map(({ kind, label, x, y, w, h }) => ({ kind, label, x, y, w, h })) });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    stopEdit();
    onSaved();
  }

  const pickedRack = picked?.type === "rack" ? racks.find((rack) => rack.id === picked.id) : null;
  const pickedItem = picked?.type === "item" ? currentItems.find((item) => item.id === picked.id) : null;
  const changed = Object.keys(draft).length > 0 || (items !== null && JSON.stringify(items) !== JSON.stringify(savedItems));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button type="button" size="xs" variant={mode === "usage" ? "default" : "outline"} onClick={() => setMode("usage")}>
          按利用率
        </Button>
        <Button type="button" size="xs" variant={mode === "alerts" ? "default" : "outline"} onClick={() => setMode("alerts")}>
          按告警
        </Button>
        <span className="text-xs text-muted-foreground">
          {mode === "usage" ? "颜色越深 U 位用得越多，灰色是空柜。" : "红色有严重告警，黄色有警告。"}斜纹是不可用的机柜和柱子等障碍物。
          {editing ? "" : " 点机柜看正视图。"}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  if (window.confirm("把机柜都放回按列/排自动排布？柱子等障碍物留着。")) void save(racks.map((rack) => ({ id: rack.id, x: null, y: null, facing: "" })), currentItems);
                }}
              >
                恢复自动排布
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={stopEdit}>
                取消
              </Button>
              <Button
                type="button"
                size="xs"
                disabled={saving}
                // 保存时把所有机柜的当前位置都写下，自动排布的也固定住，之后新加的机柜不会把它们挤乱。
                onClick={() => void save(cells.map((cell) => ({ id: cell.rack.id, x: cell.x, y: cell.y, facing: cell.facing })), currentItems)}
              >
                {saving ? "保存中" : `保存布局${changed ? "（有改动）" : ""}`}
              </Button>
            </>
          ) : (
            <Button type="button" size="xs" variant="outline" onClick={startEdit}>
              编辑布局
            </Button>
          )}
        </span>
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
          <span className="text-xs text-muted-foreground">放障碍物：</span>
          <NativeSelect
            value={tool}
            onChange={(event) => {
              setTool(event.target.value as FloorItemKind | "");
              setPicked(null);
            }}
          >
            <option value="">不放（挪动模式）</option>
            {Object.entries(FLOOR_ITEM_KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                点空格放「{label}」
              </option>
            ))}
          </NativeSelect>
          {pickedRack ? (
            <>
              <span className="font-mono text-xs">机柜 {pickedRack.name}</span>
              <Button type="button" size="xs" variant="outline" onClick={() => turn(pickedRack)}>
                朝向：{{ "": "不设", up: "朝上", down: "朝下" }[position(pickedRack).facing]}
              </Button>
              <span className="text-xs text-muted-foreground">点空格把它挪过去</span>
            </>
          ) : null}
          {pickedItem ? (
            <>
              <NativeSelect value={pickedItem.kind} onChange={(event) => updateItem(pickedItem.id, { kind: event.target.value as FloorItemKind })}>
                {Object.entries(FLOOR_ITEM_KINDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <Input className="h-8 w-28" value={pickedItem.label} placeholder="名字，可空" maxLength={20} onChange={(event) => updateItem(pickedItem.id, { label: event.target.value })} />
              <span className="flex items-center text-xs">
                宽 {pickedItem.w}
                <Button type="button" size="xs" variant="ghost" onClick={() => resize(pickedItem, -1, 0)}>
                  −
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => resize(pickedItem, 1, 0)}>
                  ＋
                </Button>
                高 {pickedItem.h}
                <Button type="button" size="xs" variant="ghost" onClick={() => resize(pickedItem, 0, -1)}>
                  −
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => resize(pickedItem, 0, 1)}>
                  ＋
                </Button>
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setItems((list) => (list || []).filter((item) => item.id !== pickedItem.id));
                  setPicked(null);
                }}
              >
                删除
              </Button>
              <span className="text-xs text-muted-foreground">点空格把它挪过去</span>
            </>
          ) : null}
          {!picked && !tool ? <span className="text-xs text-muted-foreground">点机柜或障碍物选中，再点空格挪过去；机柜也可以直接拖。</span> : null}
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="overflow-auto rounded-md border bg-card p-2">
        <div className="relative" style={{ width: width * CELL_W, height: height * CELL_H }}>
          {editing
            ? Array.from({ length: width * height }, (_, index) => {
                const x = index % width;
                const y = Math.floor(index / width);
                if (occupied(x, y)) return null;
                return (
                  <button
                    key={`${x}-${y}`}
                    type="button"
                    aria-label={`空格 ${x + 1},${y + 1}`}
                    className={`absolute rounded-sm border border-dashed ${picked || tool ? "border-primary/40 hover:bg-primary/10" : "border-border/50"}`}
                    style={{ left: x * CELL_W + 2, top: y * CELL_H + 2, width: CELL_W - 4, height: CELL_H - 4 }}
                    onClick={() => clickEmpty(x, y)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData("text/plain");
                      if (id) moveRack(id, x, y);
                      setPicked(null);
                    }}
                  />
                );
              })
            : null}
          {currentItems.map((item) => {
            const isPicked = picked?.type === "item" && picked.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={!editing}
                title={`${FLOOR_ITEM_KINDS[item.kind]}${item.label ? `：${item.label}` : ""}`}
                onClick={() => {
                  setTool("");
                  setPicked(isPicked ? null : { type: "item", id: item.id });
                }}
                className={`absolute flex items-center justify-center rounded-sm border border-border text-[11px] text-muted-foreground disabled:cursor-default ${isPicked ? "ring-2 ring-ring" : ""}`}
                style={{
                  left: item.x * CELL_W + 2,
                  top: item.y * CELL_H + 2,
                  width: item.w * CELL_W - 4,
                  height: item.h * CELL_H - 4,
                  backgroundImage: HATCH,
                  backgroundColor: "var(--muted)",
                }}
              >
                {item.label || FLOOR_ITEM_KINDS[item.kind]}
              </button>
            );
          })}
          {cells.map((cell) => {
            const info = infos.get(cell.rack.id)!;
            const style: React.CSSProperties = cell.rack.disabled ? { backgroundColor: "var(--muted)", backgroundImage: HATCH } : mode === "usage" ? usageStyle(info) : alertStyle(info);
            const title = [
              `${cell.rack.name}${cell.rack.rowLabel ? `（${cell.rack.rowLabel} 排）` : ""}${cell.rack.disabled ? "，不可用" : ""}`,
              `${info.devices} 台设备，U 位 ${info.used} / ${cell.rack.heightU}`,
              info.alert ? (info.alert === "critical" ? "有严重告警" : "有警告") : "",
              cell.rack.powerKw ? `额定 ${cell.rack.powerKw}` : "",
              cell.rack.note,
            ]
              .filter(Boolean)
              .join("\n");
            const isPicked = picked?.type === "rack" && picked.id === cell.rack.id;
            return (
              <button
                key={cell.rack.id}
                type="button"
                title={title}
                draggable={editing}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", cell.rack.id)}
                onClick={() => {
                  if (!editing) {
                    onOpenRack(cell.rack.id);
                    return;
                  }
                  setTool("");
                  setPicked(isPicked ? null : { type: "rack", id: cell.rack.id });
                }}
                className={`absolute flex flex-col items-center justify-center rounded-sm border text-[11px] leading-4 transition-shadow ${isPicked ? "ring-2 ring-ring" : ""} ${draft[cell.rack.id] ? "border-primary" : "border-border"}`}
                style={{ ...style, left: cell.x * CELL_W + 2, top: cell.y * CELL_H + 2, width: CELL_W - 4, height: CELL_H - 4 }}
              >
                {cell.facing === "up" ? <span className="absolute top-0 right-0 left-0 h-1 rounded-t-sm bg-foreground/60" /> : null}
                {cell.facing === "down" ? <span className="absolute right-0 bottom-0 left-0 h-1 rounded-b-sm bg-foreground/60" /> : null}
                <span className="font-mono font-semibold">{cell.rack.name}</span>
                <span className="opacity-80">{cell.rack.disabled ? "不可用" : mode === "usage" ? `${Math.round((info.used / cell.rack.heightU) * 100)}%` : `${info.devices} 台`}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">机柜边上的深色条是正面。还没摆过位置的机柜按列/排自动排成一行行（排之间空一行当通道），遇到柱子等障碍物往后挪一格。</p>
    </div>
  );
}
