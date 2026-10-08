"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AssetRow } from "@/lib/asset-view";
import { api } from "@/lib/client-api";
import { floorPositions } from "@/lib/floor";
import type { AlertSeverity, Rack, RackFacing } from "@/lib/types";

const CELL_W = 64;
const CELL_H = 44;

type Mode = "usage" | "alerts";

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

/**
 * 机房俯视图：每个机柜一格，按利用率或告警上色。编辑布局时点一个机柜选中，再点空格挪过去（也可以直接拖），
 * 可以设正面朝向；保存后才写入。点机柜（不在编辑时）跳到它的正视图。
 */
export function RackFloor({
  siteId,
  racks,
  assets,
  alerts,
  onOpenRack,
  onSaved,
}: {
  siteId: string;
  racks: Rack[];
  assets: AssetRow[];
  /** 资产 id → 最严重的未恢复告警。 */
  alerts: Record<string, AlertSeverity>;
  onOpenRack: (rackId: string) => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<Mode>("usage");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { x: number; y: number; facing: RackFacing }>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  const saved = useMemo(() => floorPositions(racks), [racks]);
  const position = (rack: Rack) => draft[rack.id] || { ...saved.get(rack.id)!, facing: rack.facing };
  const cells = racks.map((rack) => ({ rack, ...position(rack) }));
  const width = Math.max(8, ...cells.map((cell) => cell.x + 2));
  const height = Math.max(4, ...cells.map((cell) => cell.y + 2));
  const at = (x: number, y: number) => cells.find((cell) => cell.x === x && cell.y === y);

  function move(rackId: string, x: number, y: number) {
    if (at(x, y)) return;
    const rack = racks.find((item) => item.id === rackId)!;
    setDraft((current) => ({ ...current, [rackId]: { x, y, facing: position(rack).facing } }));
    setPicked(null);
  }

  function turn(rackId: string) {
    const rack = racks.find((item) => item.id === rackId)!;
    const now = position(rack);
    const next: RackFacing = now.facing === "" ? "up" : now.facing === "up" ? "down" : "";
    setDraft((current) => ({ ...current, [rackId]: { x: now.x, y: now.y, facing: next } }));
  }

  async function save(items: { id: string; x: number | null; y: number | null; facing?: RackFacing }[]) {
    setSaving(true);
    const result = await api(`/api/sites/${siteId}/layout`, "PUT", { items });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setDraft({});
    setEditing(false);
    setPicked(null);
    onSaved();
  }

  const pickedRack = picked ? racks.find((rack) => rack.id === picked) : null;
  const changed = Object.keys(draft).length;

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
          {mode === "usage" ? "颜色越深 U 位用得越多，灰色是空柜。" : "红色有严重告警，黄色有警告。"}
          {editing ? "" : " 点机柜看正视图。"}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {editing ? (
            <>
              {pickedRack ? (
                <Button type="button" size="xs" variant="outline" onClick={() => turn(pickedRack.id)}>
                  {pickedRack.name} 朝向：{{ "": "不设", up: "朝上", down: "朝下" }[position(pickedRack).facing]}
                </Button>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  if (window.confirm("把这个机房的机柜都放回按列/排自动排布？")) void save(racks.map((rack) => ({ id: rack.id, x: null, y: null, facing: "" })));
                }}
              >
                恢复自动排布
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setDraft({});
                  setEditing(false);
                  setPicked(null);
                }}
              >
                取消
              </Button>
              <Button
                type="button"
                size="xs"
                disabled={saving}
                onClick={() =>
                  // 保存时把所有机柜的当前位置都写下，自动排布的也固定住，之后新加的机柜不会把它们挤乱。
                  void save(cells.map((cell) => ({ id: cell.rack.id, x: cell.x, y: cell.y, facing: cell.facing })))
                }
              >
                {saving ? "保存中" : `保存布局${changed ? `（改了 ${changed} 个）` : ""}`}
              </Button>
            </>
          ) : (
            <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
              编辑布局
            </Button>
          )}
        </span>
      </div>
      {editing ? <p className="text-xs text-muted-foreground">点一个机柜选中（再点「朝向」可以设正面朝上或朝下），然后点空格把它挪过去；也可以直接拖。改完点「保存布局」。</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="overflow-auto rounded-md border bg-card p-2">
        <div className="relative" style={{ width: width * CELL_W, height: height * CELL_H }}>
          {editing
            ? Array.from({ length: width * height }, (_, index) => {
                const x = index % width;
                const y = Math.floor(index / width);
                if (at(x, y)) return null;
                return (
                  <button
                    key={`${x}-${y}`}
                    type="button"
                    aria-label={`空格 ${x + 1},${y + 1}`}
                    className={`absolute rounded-sm border border-dashed ${picked ? "border-primary/40 hover:bg-primary/10" : "border-border/50"}`}
                    style={{ left: x * CELL_W + 2, top: y * CELL_H + 2, width: CELL_W - 4, height: CELL_H - 4 }}
                    onClick={() => picked && move(picked, x, y)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData("text/plain");
                      if (id) move(id, x, y);
                    }}
                  />
                );
              })
            : null}
          {cells.map((cell) => {
            const info = infos.get(cell.rack.id)!;
            const style = mode === "usage" ? usageStyle(info) : alertStyle(info);
            const title = [
              `${cell.rack.name}${cell.rack.rowLabel ? `（${cell.rack.rowLabel} 排）` : ""}`,
              `${info.devices} 台设备，U 位 ${info.used} / ${cell.rack.heightU}`,
              info.alert ? (info.alert === "critical" ? "有严重告警" : "有警告") : "",
              cell.rack.powerKw ? `额定 ${cell.rack.powerKw}` : "",
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <button
                key={cell.rack.id}
                type="button"
                title={title}
                draggable={editing}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", cell.rack.id)}
                onClick={() => (editing ? setPicked(picked === cell.rack.id ? null : cell.rack.id) : onOpenRack(cell.rack.id))}
                className={`absolute flex flex-col items-center justify-center rounded-sm border text-[11px] leading-4 transition-shadow ${picked === cell.rack.id ? "ring-2 ring-ring" : ""} ${draft[cell.rack.id] ? "border-primary" : "border-border"}`}
                style={{ ...style, left: cell.x * CELL_W + 2, top: cell.y * CELL_H + 2, width: CELL_W - 4, height: CELL_H - 4 }}
              >
                {cell.facing === "up" ? <span className="absolute top-0 left-0 right-0 h-1 rounded-t-sm bg-foreground/60" /> : null}
                {cell.facing === "down" ? <span className="absolute right-0 bottom-0 left-0 h-1 rounded-b-sm bg-foreground/60" /> : null}
                <span className="font-mono font-semibold">{cell.rack.name}</span>
                <span className="opacity-80">{mode === "usage" ? `${Math.round((info.used / cell.rack.heightU) * 100)}%` : `${info.devices} 台`}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">机柜边上的深色条是正面。还没摆过位置的机柜按列/排自动排成一行行，排之间空一行当通道。</p>
    </div>
  );
}
