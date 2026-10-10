"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import AcUnitOutlined from "@mui/icons-material/AcUnitOutlined";
import ArrowBackOutlined from "@mui/icons-material/ArrowBackOutlined";
import ArrowDownwardOutlined from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowForwardOutlined from "@mui/icons-material/ArrowForwardOutlined";
import ArrowUpwardOutlined from "@mui/icons-material/ArrowUpwardOutlined";
import BatteryChargingFullOutlined from "@mui/icons-material/BatteryChargingFullOutlined";
import BlockOutlined from "@mui/icons-material/BlockOutlined";
import BoltOutlined from "@mui/icons-material/BoltOutlined";
import CategoryOutlined from "@mui/icons-material/CategoryOutlined";
import CropSquareOutlined from "@mui/icons-material/CropSquareOutlined";
import LocalFireDepartmentOutlined from "@mui/icons-material/LocalFireDepartmentOutlined";
import MeetingRoomOutlined from "@mui/icons-material/MeetingRoomOutlined";
import NearMeOutlined from "@mui/icons-material/NearMeOutlined";
import PowerSettingsNewOutlined from "@mui/icons-material/PowerSettingsNewOutlined";
import { FLOOR_ITEM_KINDS, RACK_FACING } from "@/lib/asset-labels";
import type { AssetRow } from "@/lib/asset-view";
import { api } from "@/lib/client-api";
import { floorPositions, moveKeys, planProblem, shiftRow, type Plan } from "@/lib/floor";
import type { AlertSeverity, FloorItem, FloorItemKind, FloorWall, Rack, RackFacing } from "@/lib/types";

const CELL_W = 64;
const CELL_H = 44;
/** 外墙的厚度（像素）。 */
const WALL = 12;
const MONO = "var(--font-geist-mono), monospace";

type Mode = "usage" | "alerts";
type Obstacle = Omit<FloorItem, "siteId">;
/** 选中的东西：r:<机柜 id> 或 i:<障碍物 id>。 */
type Key = string;


interface RackInfo {
  rack: Rack;
  used: number;
  devices: number;
  alert: AlertSeverity | null;
}

/** 能开在墙上的东西。 */
const WALL_KINDS: FloorItemKind[] = ["door", "switch", "fire", "other"];

const ICONS: Record<FloorItemKind, React.ElementType> = {
  door: MeetingRoomOutlined,
  pillar: CropSquareOutlined,
  ac: AcUnitOutlined,
  power: BoltOutlined,
  switch: PowerSettingsNewOutlined,
  ups: BatteryChargingFullOutlined,
  fire: LocalFireDepartmentOutlined,
  blocked: BlockOutlined,
  other: CategoryOutlined,
};

const FACING_BUTTONS: [RackFacing, React.ReactNode][] = [
  ["up", <ArrowUpwardOutlined key="up" fontSize="small" />],
  ["down", <ArrowDownwardOutlined key="down" fontSize="small" />],
  ["left", <ArrowBackOutlined key="left" fontSize="small" />],
  ["right", <ArrowForwardOutlined key="right" fontSize="small" />],
  ["", "不设"],
];

/** 斜纹：不可用的机柜和位置。 */
function hatch(theme: Theme) {
  return {
    backgroundColor: (theme.vars || theme).palette.action.hover,
    backgroundImage: `repeating-linear-gradient(45deg, ${theme.alpha((theme.vars || theme).palette.text.primary, 0.14)} 0 5px, transparent 5px 10px)`,
  };
}

/** 每类东西的颜色，一眼能分出门、空调、配电。 */
function itemStyle(theme: Theme, kind: FloorItemKind) {
  const palette = (theme.vars || theme).palette;
  const tint = (color: string, amount: number) => ({ backgroundColor: theme.alpha(color, amount), borderColor: theme.alpha(color, 0.6) });
  switch (kind) {
    case "pillar":
      return { backgroundColor: palette.grey[600], borderColor: palette.grey[700], color: palette.common.white };
    case "ac":
      return tint(palette.info.main, 0.18);
    case "power":
      return tint(palette.warning.main, 0.22);
    case "switch":
      return tint(palette.secondary.main, 0.18);
    case "ups":
      return tint(palette.success.main, 0.18);
    case "fire":
      return tint(palette.error.main, 0.16);
    case "door":
      return tint(palette.warning.dark, 0.35);
    case "blocked":
      return hatch(theme);
    default:
      return { backgroundColor: palette.action.hover };
  }
}

/** 利用率配色：越满越深。没设备是浅灰。 */
function usageStyle(theme: Theme, info: RackInfo) {
  const palette = (theme.vars || theme).palette;
  if (!info.devices) return { backgroundColor: palette.action.hover };
  const ratio = Math.min(1, info.used / info.rack.heightU);
  return {
    backgroundColor: `color-mix(in oklab, ${palette.primary.main} ${Math.round(20 + ratio * 70)}%, ${palette.background.paper})`,
    ...(ratio > 0.5 ? { color: palette.primary.contrastText } : {}),
  };
}

function alertStyle(theme: Theme, info: RackInfo) {
  const palette = (theme.vars || theme).palette;
  if (info.alert === "critical") return { backgroundColor: palette.error.main, color: palette.error.contrastText };
  if (info.alert === "warning") return { backgroundColor: `color-mix(in oklab, ${palette.warning.main} 70%, ${palette.background.paper})` };
  return { backgroundColor: info.devices ? `color-mix(in oklab, ${palette.primary.main} 25%, ${palette.background.paper})` : palette.action.hover };
}

const horizontal = (side: FloorWall) => side === "top" || side === "bottom";

/** 东西在画布上的像素框（相对外墙内侧的左上角）。墙上的画在墙里。 */
function itemBox(item: Obstacle, room: { w: number; h: number }): { left: number; top: number; width: number; height: number } {
  if (!item.side) return { left: item.x * CELL_W, top: item.y * CELL_H, width: item.w * CELL_W, height: item.h * CELL_H };
  if (item.side === "top") return { left: item.x * CELL_W, top: -WALL, width: item.w * CELL_W, height: WALL };
  if (item.side === "bottom") return { left: item.x * CELL_W, top: room.h * CELL_H, width: item.w * CELL_W, height: WALL };
  if (item.side === "left") return { left: -WALL, top: item.y * CELL_H, width: WALL, height: item.w * CELL_H };
  return { left: room.w * CELL_W, top: item.y * CELL_H, width: WALL, height: item.w * CELL_H };
}

/**
 * 机房平面图：外墙和门、机柜（按利用率或告警上色）、柱子、空调、配电柜、电力开关、UPS、消防等。
 * 编辑时：上面选工具，点空格放东西（门、开关可以点在墙上）；放到机柜上会问是把后面的机柜往右挪，还是换掉这个空柜。
 * 点选、Shift/Ctrl 加选、在空白处拖框多选；拖动或方向键整体挪；选中的机柜一起改朝向；Ctrl+Z 撤销。
 * 都先在页面上改，点「保存」才写入。不在编辑时点机柜跳到它的正视图。
 */
export function RackFloor({
  siteId,
  room,
  racks,
  obstacles,
  assets,
  alerts,
  onOpenRack,
  onSaved,
}: {
  siteId: string;
  /** 机房的宽、深（格子数），0 是没设。 */
  room: { w: number; h: number };
  racks: Rack[];
  obstacles: FloorItem[];
  assets: AssetRow[];
  /** 资产 id → 最严重的未恢复告警。 */
  alerts: Record<string, AlertSeverity>;
  onOpenRack: (rackId: string) => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<Mode>("usage");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [tool, setTool] = useState<FloorItemKind | "">("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState<{ type: "move" | "box"; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [onRack, setOnRack] = useState<{ rackId: string; x: number; y: number; kind: FloorItemKind } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const editing = plan !== null;

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

  const saved = useMemo<Plan>(() => {
    const items: Obstacle[] = obstacles.map((item) => ({ id: item.id, kind: item.kind, label: item.label, x: item.x, y: item.y, w: item.w, h: item.h, side: item.side || "" }));
    const auto = floorPositions(racks, items);
    return {
      racks: Object.fromEntries(racks.map((rack) => [rack.id, { x: auto.get(rack.id)!.x, y: auto.get(rack.id)!.y, facing: rack.facing }])),
      items,
      room: { w: room.w, h: room.h },
      removed: [],
    };
  }, [racks, obstacles, room.w, room.h]);
  const view = plan ?? saved;

  const rackName = (id: string) => racks.find((rack) => rack.id === id)?.name || "";
  const cells = racks.filter((rack) => view.racks[rack.id] && !view.removed.includes(rack.id)).map((rack) => ({ rack, ...view.racks[rack.id] }));
  const interior = view.items.filter((item) => !item.side);
  const walled = view.room.w > 0 && view.room.h > 0;
  const width = walled ? view.room.w : Math.max(8, ...cells.map((cell) => cell.x + (editing ? 3 : 1)), ...interior.map((item) => item.x + item.w + (editing ? 2 : 0)));
  const height = walled ? view.room.h : Math.max(4, ...cells.map((cell) => cell.y + (editing ? 3 : 1)), ...interior.map((item) => item.y + item.h + (editing ? 2 : 0)));
  const pad = walled ? WALL : 0;

  // ---------- 改动 ----------

  function commit(next: Plan) {
    if (!plan) return;
    setHistory((list) => [...list.slice(-49), plan]);
    setPlan(next);
    setError("");
  }

  const undo = useCallback(() => {
    setHistory((list) => {
      if (!list.length) return list;
      setPlan(list[list.length - 1]);
      setError("");
      return list.slice(0, -1);
    });
  }, []);

  function tryCommit(next: Plan): boolean {
    const issue = planProblem(next, rackName);
    if (issue) {
      setError(issue);
      return false;
    }
    commit(next);
    return true;
  }

  /** 格子被谁占着（只看机房里面的格子）。 */
  function occupant(target: Plan, x: number, y: number): Key | null {
    for (const [id, pos] of Object.entries(target.racks)) if (!target.removed.includes(id) && pos.x === x && pos.y === y) return `r:${id}`;
    for (const item of target.items) if (!item.side && x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h) return `i:${item.id}`;
    return null;
  }

  /** 把选中的东西整体挪 dx、dy 格。墙上的只沿着墙挪。 */
  function moveSelection(dx: number, dy: number) {
    if (!plan || (!dx && !dy) || !selected.size) return;
    tryCommit(moveKeys(plan, selected, dx, dy));
  }

  function newItem(kind: FloorItemKind, x: number, y: number, side: FloorWall = ""): Obstacle {
    return { id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, label: "", x, y, w: 1, h: 1, side };
  }

  function addItem(kind: FloorItemKind, x: number, y: number, side: FloorWall = "") {
    if (!plan) return;
    const item = newItem(kind, x, y, side);
    if (tryCommit({ ...plan, items: [...plan.items, item] })) setSelected(new Set([`i:${item.id}`]));
  }

  /** 东西放到机柜上：这一排从这个机柜起往右的机柜和一格深的障碍物都往右挪一格，再放进去。 */
  function shiftRightAndPlace(target: NonNullable<typeof onRack>) {
    if (!plan) return;
    const item = newItem(target.kind, target.x, target.y);
    const next = shiftRow(plan, target.x, target.y);
    next.items.push(item);
    const issue = planProblem(next, rackName);
    if (issue) {
      setError(`挪不了：${issue}${walled ? "。可以先把机房改宽" : ""}`);
      return;
    }
    commit(next);
    setSelected(new Set([`i:${item.id}`]));
  }

  /** 东西放到空机柜上：保存时删掉这个机柜，东西放在它的位置。 */
  function replaceRack(target: NonNullable<typeof onRack>) {
    if (!plan) return;
    const item = newItem(target.kind, target.x, target.y);
    if (tryCommit({ ...plan, removed: [...plan.removed, target.rackId], items: [...plan.items, item] })) setSelected(new Set([`i:${item.id}`]));
  }

  function setFacing(facing: RackFacing) {
    if (!plan) return;
    const next: Plan = { ...plan, racks: { ...plan.racks } };
    for (const key of selected) {
      const id = key.slice(2);
      if (key.startsWith("r:") && next.racks[id]) next.racks[id] = { ...next.racks[id], facing };
    }
    commit(next);
  }

  function updateItem(id: string, patch: Partial<Obstacle>) {
    if (!plan) return;
    tryCommit({ ...plan, items: plan.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }

  function deleteSelectedItems() {
    if (!plan) return;
    const ids = [...selected].filter((key) => key.startsWith("i:")).map((key) => key.slice(2));
    if (!ids.length) {
      setError("机柜在正视图里删；这里能删柱子、门这类东西");
      return;
    }
    commit({ ...plan, items: plan.items.filter((item) => !ids.includes(item.id)) });
    setSelected(new Set());
  }

  /** 机房大小按现在摆的东西算，右边和下边各留一格。 */
  function fitRoom() {
    if (!plan) return;
    const live = Object.entries(plan.racks).filter(([id]) => !plan.removed.includes(id));
    const inner = plan.items.filter((item) => !item.side);
    const w = Math.max(4, ...live.map(([, pos]) => pos.x + 1), ...inner.map((item) => item.x + item.w)) + 1;
    const h = Math.max(3, ...live.map(([, pos]) => pos.y + 1), ...inner.map((item) => item.y + item.h)) + 1;
    tryCommit({ ...plan, room: { w, h } });
  }

  function setRoom(w: number, h: number) {
    if (!plan) return;
    const next = { ...plan, room: { w: Math.max(0, Math.min(200, Math.floor(w) || 0)), h: Math.max(0, Math.min(200, Math.floor(h) || 0)) } };
    // 正在打字时不拦着，只提示；保存时再检查。
    setPlan(next);
    setError(next.room.w && next.room.h ? planProblem(next, rackName) : "");
  }

  function startEdit() {
    setPlan(saved);
    setHistory([]);
    setSelected(new Set());
    setTool("");
    setError("");
  }

  function stopEdit() {
    setPlan(null);
    setHistory([]);
    setSelected(new Set());
    setTool("");
    setError("");
  }

  async function save() {
    if (!plan) return;
    if (!plan.room.w !== !plan.room.h) return setError("机房的宽和深要一起填，或者都清空");
    const issue = planProblem(plan, rackName);
    if (issue) return setError(issue);
    if (plan.removed.length && !window.confirm(`保存时会删掉 ${plan.removed.map(rackName).join("、")} 这 ${plan.removed.length} 个机柜（换成了柱子等），确定？`)) return;
    setSaving(true);
    const result = await api(`/api/sites/${siteId}/layout`, "PUT", {
      items: cells.map((cell) => ({ id: cell.rack.id, x: cell.x, y: cell.y, facing: cell.facing })),
      obstacles: plan.items.map(({ kind, label, x, y, w, h, side }) => ({ kind, label, x, y, w, h, side })),
      remove: plan.removed,
      room: plan.room,
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    stopEdit();
    onSaved();
  }

  async function resetAuto() {
    if (!window.confirm("把机柜都放回按列/排自动排布？柱子、门等留着，没保存的改动会丢掉。")) return;
    setSaving(true);
    const result = await api(`/api/sites/${siteId}/layout`, "PUT", { items: racks.map((rack) => ({ id: rack.id, x: null, y: null, facing: "" })) });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    stopEdit();
    onSaved();
  }

  // ---------- 鼠标 ----------

  function local(event: { clientX: number; clientY: number }): { px: number; py: number } {
    const rect = canvas.current!.getBoundingClientRect();
    return { px: event.clientX - rect.left - pad, py: event.clientY - rect.top - pad };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!plan || event.button !== 0) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-key], [data-wall]");
    const { px, py } = local(event);
    const cx = Math.floor(px / CELL_W);
    const cy = Math.floor(py / CELL_H);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    setError("");

    if (tool) {
      const wall = target?.dataset.wall as FloorWall | undefined;
      if (wall) {
        const offset = horizontal(wall) ? Math.max(0, Math.min(plan.room.w - 1, cx)) : Math.max(0, Math.min(plan.room.h - 1, cy));
        addItem(tool, horizontal(wall) ? offset : 0, horizontal(wall) ? 0 : offset, wall);
        return;
      }
      const key = occupant(plan, cx, cy);
      if (key?.startsWith("r:")) {
        const pos = plan.racks[key.slice(2)];
        setOnRack({ rackId: key.slice(2), x: pos.x, y: pos.y, kind: tool });
        return;
      }
      if (key || target?.dataset.key) {
        setError("这里已经有东西了");
        return;
      }
      if (cx >= 0 && cy >= 0) addItem(tool, cx, cy);
      return;
    }

    const key = target?.dataset.key;
    if (key && additive) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    if (key && !selected.has(key)) setSelected(new Set([key]));
    if (!key && !additive) setSelected(new Set());
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ type: key ? "move" : "box", x0: px, y0: py, x1: px, y1: py });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const { px, py } = local(event);
    setDrag({ ...drag, x1: px, y1: py });
  }

  const dragCells = drag?.type === "move" ? { dx: Math.round((drag.x1 - drag.x0) / CELL_W), dy: Math.round((drag.y1 - drag.y0) / CELL_H) } : { dx: 0, dy: 0 };

  function onPointerUp() {
    if (!drag || !plan) return setDrag(null);
    if (drag.type === "move") moveSelection(dragCells.dx, dragCells.dy);
    else {
      const [left, right] = [Math.min(drag.x0, drag.x1), Math.max(drag.x0, drag.x1)];
      const [top, bottom] = [Math.min(drag.y0, drag.y1), Math.max(drag.y0, drag.y1)];
      if (right - left > 4 || bottom - top > 4) {
        const hit = (box: { left: number; top: number; width: number; height: number }) => box.left < right && box.left + box.width > left && box.top < bottom && box.top + box.height > top;
        const keys = new Set(selected);
        for (const cell of cells) if (hit({ left: cell.x * CELL_W, top: cell.y * CELL_H, width: CELL_W, height: CELL_H })) keys.add(`r:${cell.rack.id}`);
        for (const item of plan.items) if (hit(itemBox(item, plan.room))) keys.add(`i:${item.id}`);
        setSelected(keys);
      }
    }
    setDrag(null);
  }

  // ---------- 键盘 ----------

  // 每次渲染重新挂，拿到最新的 plan 和选中项。
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || onRack) return;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[event.key] && selected.size) {
        event.preventDefault();
        moveSelection(...arrows[event.key]);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selected.size) {
        event.preventDefault();
        deleteSelectedItems();
      } else if (event.key === "Escape") {
        setTool("");
        setSelected(new Set());
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(new Set([...cells.map((cell) => `r:${cell.rack.id}`), ...(plan?.items || []).map((item) => `i:${item.id}`)]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 画 ----------

  const selRacks = [...selected].filter((key) => key.startsWith("r:")).map((key) => key.slice(2));
  const selItems = view.items.filter((item) => selected.has(`i:${item.id}`));
  const single = selItems.length === 1 && selected.size === 1 ? selItems[0] : null;
  const commonFacing = selRacks.length && selRacks.every((id) => view.racks[id]?.facing === view.racks[selRacks[0]]?.facing) ? view.racks[selRacks[0]]?.facing : null;
  const pendingRack = onRack ? racks.find((rack) => rack.id === onRack.rackId) : null;
  const pendingDevices = onRack ? infos.get(onRack.rackId)?.devices || 0 : 0;
  const changed = editing && JSON.stringify(plan) !== JSON.stringify(saved);
  const offset = (key: Key) => (drag?.type === "move" && selected.has(key) && (dragCells.dx || dragCells.dy) ? { transform: `translate(${dragCells.dx * CELL_W}px, ${dragCells.dy * CELL_H}px)`, opacity: 0.8, zIndex: 3 } : {});
  const wallTool = Boolean(editing && tool && walled);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <ToggleButtonGroup exclusive value={mode} onChange={(_, next: Mode | null) => next && setMode(next)} aria-label="上色方式">
          <ToggleButton value="usage" sx={{ px: 1.5 }}>
            按利用率
          </ToggleButton>
          <ToggleButton value="alerts" sx={{ px: 1.5 }}>
            按告警
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {mode === "usage" ? "颜色越深 U 位用得越多，灰色是空柜。" : "红色有严重告警，黄色有警告。"}机柜边上的深色条是正面。
          {editing ? "" : " 点机柜看正视图。"}
        </Typography>
        <Stack direction="row" useFlexGap spacing={1} sx={{ ml: "auto", flexWrap: "wrap" }}>
          {editing ? (
            <>
              <Button type="button" disabled={!history.length} onClick={undo}>
                撤销
              </Button>
              <Button type="button" disabled={saving} onClick={() => void resetAuto()}>
                机柜恢复自动排布
              </Button>
              <Button type="button" onClick={stopEdit}>
                取消
              </Button>
              <Button type="button" variant="contained" disabled={saving} onClick={() => void save()}>
                {saving ? "保存中" : `保存${changed ? "（有改动）" : ""}`}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outlined" onClick={startEdit}>
              编辑平面图
            </Button>
          )}
        </Stack>
      </Stack>

      {plan ? (
        <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "action.hover" }}>
          <Stack spacing={1.25}>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={tool}
                onChange={(_, next: FloorItemKind | "" | null) => {
                  setTool(next ?? "");
                  setSelected(new Set());
                }}
                aria-label="工具"
                sx={{ bgcolor: "background.paper", flexWrap: "wrap" }}
              >
                <ToggleButton value="" sx={{ px: 1.25, gap: 0.5 }}>
                  <NearMeOutlined fontSize="small" />
                  选择
                </ToggleButton>
                {(Object.keys(FLOOR_ITEM_KINDS) as FloorItemKind[]).map((kind) => {
                  const Icon = ICONS[kind];
                  return (
                    <ToggleButton key={kind} value={kind} sx={{ px: 1.25, gap: 0.5 }}>
                      <Icon fontSize="small" />
                      {FLOOR_ITEM_KINDS[kind]}
                    </ToggleButton>
                  );
                })}
              </ToggleButtonGroup>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", ml: "auto" }}>
                <Typography variant="caption">机房</Typography>
                <TextField
                  size="small"
                  type="number"
                  value={plan.room.w || ""}
                  placeholder="宽"
                  onChange={(event) => setRoom(Number(event.target.value), plan.room.h)}
                  slotProps={{ htmlInput: { min: 0, max: 200, "aria-label": "机房宽（格）" } }}
                  sx={{ width: 76, bgcolor: "background.paper" }}
                />
                <Typography variant="caption">×</Typography>
                <TextField
                  size="small"
                  type="number"
                  value={plan.room.h || ""}
                  placeholder="深"
                  onChange={(event) => setRoom(plan.room.w, Number(event.target.value))}
                  slotProps={{ htmlInput: { min: 0, max: 200, "aria-label": "机房深（格）" } }}
                  sx={{ width: 76, bgcolor: "background.paper" }}
                />
                <Typography variant="caption">格</Typography>
                <Button type="button" size="small" onClick={fitRoom}>
                  按内容
                </Button>
              </Stack>
            </Stack>

            {tool ? (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                点空格放「{FLOOR_ITEM_KINDS[tool]}」{WALL_KINDS.includes(tool) ? (walled ? "，也可以点在墙上" : "；设了机房大小后也能点在墙上") : ""}；点到机柜上会问你是把它和后面的机柜往右挪，还是换掉这个空柜。按 Esc 回到选择。
              </Typography>
            ) : selected.size ? (
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <Typography variant="caption">
                  选了 {selected.size} 个{selRacks.length ? `（机柜 ${selRacks.length}）` : ""}
                </Typography>
                {selRacks.length ? (
                  <>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      正面
                    </Typography>
                    <ToggleButtonGroup exclusive size="small" value={commonFacing} onChange={(_, next: RackFacing | null) => next !== null && setFacing(next)} aria-label="朝向" sx={{ bgcolor: "background.paper" }}>
                      {FACING_BUTTONS.map(([value, icon]) => (
                        <ToggleButton key={value || "none"} value={value} aria-label={`正面${RACK_FACING[value]}`} title={`正面${RACK_FACING[value]}`} sx={{ px: 1, fontSize: 12 }}>
                          {icon}
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                    <Button
                      type="button"
                      size="small"
                      onClick={() => {
                        const rows = new Set(selRacks.map((id) => view.racks[id]?.y));
                        setSelected(new Set([...selected, ...cells.filter((cell) => rows.has(cell.y)).map((cell) => `r:${cell.rack.id}`)]));
                      }}
                    >
                      选同一排
                    </Button>
                  </>
                ) : null}
                {single ? (
                  <>
                    <TextField select size="small" slotProps={{ select: { native: true } }} value={single.kind} onChange={(event) => updateItem(single.id, { kind: event.target.value as FloorItemKind })} sx={{ bgcolor: "background.paper" }}>
                      {(Object.keys(FLOOR_ITEM_KINDS) as FloorItemKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {FLOOR_ITEM_KINDS[kind]}
                        </option>
                      ))}
                    </TextField>
                    <TextField size="small" value={single.label} placeholder="名字，可空" slotProps={{ htmlInput: { maxLength: 20 } }} onChange={(event) => updateItem(single.id, { label: event.target.value })} sx={{ width: 120, bgcolor: "background.paper" }} />
                    <Stack direction="row" sx={{ alignItems: "center" }}>
                      <Typography variant="caption">
                        {single.side ? "长" : "宽"} {single.w}
                      </Typography>
                      <Button type="button" size="small" aria-label="变小" sx={{ minWidth: 28 }} onClick={() => updateItem(single.id, { w: Math.max(1, single.w - 1) })}>
                        −
                      </Button>
                      <Button type="button" size="small" aria-label="变大" sx={{ minWidth: 28 }} onClick={() => updateItem(single.id, { w: Math.min(20, single.w + 1) })}>
                        ＋
                      </Button>
                      {single.side ? null : (
                        <>
                          <Typography variant="caption">深 {single.h}</Typography>
                          <Button type="button" size="small" aria-label="变浅" sx={{ minWidth: 28 }} onClick={() => updateItem(single.id, { h: Math.max(1, single.h - 1) })}>
                            −
                          </Button>
                          <Button type="button" size="small" aria-label="变深" sx={{ minWidth: 28 }} onClick={() => updateItem(single.id, { h: Math.min(20, single.h + 1) })}>
                            ＋
                          </Button>
                          <Button type="button" size="small" onClick={() => updateItem(single.id, { w: single.h, h: single.w })}>
                            转 90°
                          </Button>
                        </>
                      )}
                    </Stack>
                  </>
                ) : null}
                {selItems.length ? (
                  <Button type="button" size="small" color="error" onClick={deleteSelectedItems}>
                    删除
                  </Button>
                ) : null}
              </Stack>
            ) : (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                点选，Shift/Ctrl 加选，在空白处拖框多选；拖动或按方向键整体挪；选了机柜后能一起改朝向、选同一排；Delete 删柱子门这类东西；Ctrl+Z 撤销。
              </Typography>
            )}
          </Stack>
        </Paper>
      ) : null}
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}

      <Paper variant="outlined" sx={{ overflow: "auto", p: 1.5 }}>
        <Box
          ref={canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          sx={(theme) => ({
            position: "relative",
            width: width * CELL_W + pad * 2,
            height: height * CELL_H + pad * 2,
            userSelect: "none",
            touchAction: editing ? "none" : "auto",
            cursor: editing && tool ? "copy" : "default",
            // 编辑时画格子线，方便对齐。
            ...(editing
              ? {
                  backgroundImage: `linear-gradient(${(theme.vars || theme).palette.divider} 1px, transparent 1px), linear-gradient(90deg, ${(theme.vars || theme).palette.divider} 1px, transparent 1px)`,
                  backgroundSize: `${CELL_W}px ${CELL_H}px`,
                  backgroundPosition: `${pad}px ${pad}px`,
                }
              : {}),
          })}
        >
          {walled ? <Box sx={{ position: "absolute", inset: 0, border: `${WALL}px solid`, borderColor: "text.secondary", opacity: 0.5, pointerEvents: "none" }} /> : null}
          {wallTool
            ? (["top", "bottom", "left", "right"] as FloorWall[]).map((side) => (
                <Box
                  key={side}
                  data-wall={side}
                  title="点在墙上放"
                  sx={{
                    position: "absolute",
                    ...(side === "top" ? { left: pad, top: 0, width: width * CELL_W, height: WALL } : {}),
                    ...(side === "bottom" ? { left: pad, top: pad + height * CELL_H, width: width * CELL_W, height: WALL } : {}),
                    ...(side === "left" ? { left: 0, top: pad, width: WALL, height: height * CELL_H } : {}),
                    ...(side === "right" ? { left: pad + width * CELL_W, top: pad, width: WALL, height: height * CELL_H } : {}),
                    cursor: "copy",
                    zIndex: 2,
                    "&:hover": { bgcolor: "primary.main", opacity: 0.45 },
                  }}
                />
              ))
            : null}

          {view.items.map((item) => {
            const key = `i:${item.id}`;
            const box = itemBox(item, view.room);
            const Icon = ICONS[item.kind];
            const roomy = box.width >= CELL_W && box.height >= CELL_H * 0.9;
            const name = item.label || FLOOR_ITEM_KINDS[item.kind];
            const inset = item.side ? 0 : 2;
            return (
              <Box
                key={item.id}
                data-key={editing ? key : undefined}
                title={`${FLOOR_ITEM_KINDS[item.kind]}${item.label ? `：${item.label}` : ""}${item.side ? "（墙上）" : ""}`}
                sx={(theme) => ({
                  position: "absolute",
                  left: pad + box.left + inset,
                  top: pad + box.top + inset,
                  width: box.width - inset * 2,
                  height: box.height - inset * 2,
                  display: "flex",
                  flexDirection: roomy ? "column" : "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0.25,
                  borderRadius: item.side ? 0 : 0.5,
                  border: 1,
                  borderColor: "divider",
                  fontSize: 11,
                  lineHeight: "14px",
                  color: "text.secondary",
                  overflow: "hidden",
                  cursor: editing && !tool ? "move" : "inherit",
                  zIndex: item.side ? 3 : 1,
                  ...itemStyle(theme, item.kind),
                  ...(selected.has(key) ? { outline: `2px solid ${(theme.vars || theme).palette.primary.main}`, outlineOffset: 1 } : {}),
                  ...offset(key),
                })}
              >
                {item.side ? null : <Icon sx={{ fontSize: 16 }} />}
                {!item.side && roomy ? (
                  <Box component="span" sx={{ px: 0.25, textAlign: "center", wordBreak: "break-all" }}>
                    {name}
                  </Box>
                ) : null}
              </Box>
            );
          })}

          {cells.map((cell) => {
            const key = `r:${cell.rack.id}`;
            const info = infos.get(cell.rack.id)!;
            const title = [
              `${cell.rack.name}${cell.rack.rowLabel ? `（${cell.rack.rowLabel} 排）` : ""}${cell.rack.disabled ? "，不可用" : ""}`,
              `${info.devices} 台设备，U 位 ${info.used} / ${cell.rack.heightU}`,
              `正面${RACK_FACING[cell.facing]}`,
              info.alert ? (info.alert === "critical" ? "有严重告警" : "有警告") : "",
              cell.rack.powerKw ? `额定 ${cell.rack.powerKw}` : "",
              cell.rack.note,
            ]
              .filter(Boolean)
              .join("\n");
            const bar = { position: "absolute", bgcolor: "text.secondary" } as const;
            return (
              <Box
                key={cell.rack.id}
                data-key={editing ? key : undefined}
                role={editing ? undefined : "button"}
                tabIndex={editing ? undefined : 0}
                title={title}
                onClick={() => {
                  if (!editing) onOpenRack(cell.rack.id);
                }}
                onKeyDown={(event) => {
                  if (!editing && (event.key === "Enter" || event.key === " ")) onOpenRack(cell.rack.id);
                }}
                sx={(theme) => ({
                  color: "text.primary",
                  ...(cell.rack.disabled ? hatch(theme) : mode === "usage" ? usageStyle(theme, info) : alertStyle(theme, info)),
                  position: "absolute",
                  left: pad + cell.x * CELL_W + 2,
                  top: pad + cell.y * CELL_H + 2,
                  width: CELL_W - 4,
                  height: CELL_H - 4,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  borderRadius: 0.5,
                  border: 1,
                  borderColor: "divider",
                  fontSize: 11,
                  lineHeight: "16px",
                  cursor: editing ? (tool ? "copy" : "move") : "pointer",
                  zIndex: 1,
                  ...(selected.has(key) ? { outline: `2px solid ${(theme.vars || theme).palette.primary.main}`, outlineOffset: 1 } : {}),
                  ...offset(key),
                })}
              >
                {cell.facing === "up" ? <Box component="span" sx={{ ...bar, left: 0, right: 0, top: 0, height: 4 }} /> : null}
                {cell.facing === "down" ? <Box component="span" sx={{ ...bar, left: 0, right: 0, bottom: 0, height: 4 }} /> : null}
                {cell.facing === "left" ? <Box component="span" sx={{ ...bar, top: 0, bottom: 0, left: 0, width: 4 }} /> : null}
                {cell.facing === "right" ? <Box component="span" sx={{ ...bar, top: 0, bottom: 0, right: 0, width: 4 }} /> : null}
                <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600 }}>
                  {cell.rack.name}
                </Box>
                <Box component="span" sx={{ opacity: 0.8 }}>
                  {cell.rack.disabled ? "不可用" : mode === "usage" ? `${Math.round((info.used / cell.rack.heightU) * 100)}%` : `${info.devices} 台`}
                </Box>
              </Box>
            );
          })}

          {drag?.type === "box" ? (
            <Box
              sx={(theme) => ({
                position: "absolute",
                left: pad + Math.min(drag.x0, drag.x1),
                top: pad + Math.min(drag.y0, drag.y1),
                width: Math.abs(drag.x1 - drag.x0),
                height: Math.abs(drag.y1 - drag.y0),
                border: "1px dashed",
                borderColor: "primary.main",
                bgcolor: theme.alpha((theme.vars || theme).palette.primary.main, 0.08),
                pointerEvents: "none",
                zIndex: 4,
              })}
            />
          ) : null}
        </Box>
      </Paper>
      {!editing ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          还没摆过位置的机柜按列/排自动排成一行行（排之间空一行当通道）。点「编辑平面图」可以设机房大小、开门、放柱子空调配电，批量改机柜朝向。
        </Typography>
      ) : null}

      <Dialog open={Boolean(onRack)} onClose={() => setOnRack(null)}>
        <DialogTitle>
          在机柜 {pendingRack?.name} 这里放「{onRack ? FLOOR_ITEM_KINDS[onRack.kind] : ""}」
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Button
              variant="outlined"
              onClick={() => {
                if (onRack) shiftRightAndPlace(onRack);
                setOnRack(null);
              }}
              sx={{ justifyContent: "flex-start", textAlign: "left" }}
            >
              {pendingRack?.name} 和它右边同一排的机柜都往右挪一格（机柜编号不变）
            </Button>
            <Button
              variant="outlined"
              color="warning"
              disabled={pendingDevices > 0}
              onClick={() => {
                if (onRack) replaceRack(onRack);
                setOnRack(null);
              }}
              sx={{ justifyContent: "flex-start", textAlign: "left" }}
            >
              换掉 {pendingRack?.name}：保存时删掉这个机柜，{onRack ? FLOOR_ITEM_KINDS[onRack.kind] : ""}放在它的位置
            </Button>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {pendingDevices > 0 ? `${pendingRack?.name} 里有 ${pendingDevices} 台设备，不能换掉。` : "换掉机柜只有管理员能保存。"}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOnRack(null)}>取消</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
