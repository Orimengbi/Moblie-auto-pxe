import { FLOOR_ITEM_KINDS } from "./asset-labels.ts";
import type { FloorItem, FloorWall, Rack, RackFacing } from "./types.ts";

/** 俯视图的排布。只做计算，不碰数据库，页面组件可以直接引用。 */

/**
 * 俯视图上每个机柜的格子：摆过的用自己的位置；没摆过的按列/排一排一行（排之间空一行当通道），
 * 放在已摆好的下面，遇到柱子等障碍物的格子就往后挪一格。
 */
export function floorPositions(racks: Rack[], obstacles: (Pick<FloorItem, "x" | "y" | "w" | "h"> & { side?: FloorItem["side"] })[] = []): Map<string, { x: number; y: number; auto: boolean }> {
  const out = new Map<string, { x: number; y: number; auto: boolean }>();
  // 柱子这类占的格子，自动排布要跳过去。开在墙上的门不占格子。
  const blocked = new Set<string>();
  for (const item of obstacles.filter((entry) => !entry.side)) for (let dx = 0; dx < item.w; dx++) for (let dy = 0; dy < item.h; dy++) blocked.add(`${item.x + dx},${item.y + dy}`);
  let bottom = -1;
  for (const rack of racks) {
    if (rack.posX === null || rack.posY === null) continue;
    out.set(rack.id, { x: rack.posX, y: rack.posY, auto: false });
    blocked.add(`${rack.posX},${rack.posY}`);
    bottom = Math.max(bottom, rack.posY);
  }
  const loose = racks.filter((rack) => rack.posX === null || rack.posY === null);
  const rows = new Map<string, Rack[]>();
  for (const rack of loose) rows.set(rack.rowLabel, [...(rows.get(rack.rowLabel) || []), rack]);
  const labels = [...rows.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "zh-CN", { numeric: true })));
  // 有摆好的就从它们下面隔一行开始，一个都没摆过就从第 0 行开始。
  let y = bottom >= 0 ? bottom + 2 : 0;
  for (const label of labels) {
    const row = rows.get(label)!.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    let x = 0;
    for (const rack of row) {
      while (blocked.has(`${x},${y}`)) x++;
      out.set(rack.id, { x, y, auto: true });
      x++;
    }
    y += 2;
  }
  return out;
}

// ---------- 平面图编辑 ----------

/** 编辑中的平面图：机柜位置和朝向、障碍物（门、柱子等）、机房大小、要换掉删除的空机柜。 */
export interface Plan {
  racks: Record<string, { x: number; y: number; facing: RackFacing; disabled?: boolean }>;
  items: Omit<FloorItem, "siteId">[];
  room: { w: number; h: number };
  removed: string[];
}

const horizontal = (side: FloorWall) => side === "top" || side === "bottom";

/** 检查一份布局：不出墙、不重叠、墙上的不超出那面墙。返回问题，没问题是空。 */
export function planProblem(plan: Plan, rackName: (id: string) => string = (id) => id): string {
  const taken = new Map<string, string>();
  const fits = (x: number, y: number, w: number, h: number) => x >= 0 && y >= 0 && (!plan.room.w || (x + w <= plan.room.w && y + h <= plan.room.h));
  const occupy = (key: string, name: string) => {
    if (taken.has(key)) return `${name} 和 ${taken.get(key)} 重叠了`;
    taken.set(key, name);
    return "";
  };
  for (const [id, pos] of Object.entries(plan.racks)) {
    if (plan.removed.includes(id)) continue;
    const name = `机柜 ${rackName(id)}`;
    if (!fits(pos.x, pos.y, 1, 1)) return `${name} 出了机房的墙`;
    const issue = occupy(`${pos.x},${pos.y}`, name);
    if (issue) return issue;
  }
  const walls = new Map<string, string>();
  for (const item of plan.items) {
    const name = item.label || FLOOR_ITEM_KINDS[item.kind];
    if (item.side) {
      const along = horizontal(item.side) ? plan.room.w : plan.room.h;
      const offset = horizontal(item.side) ? item.x : item.y;
      if (!plan.room.w) return `${name} 开在墙上，要先设机房的宽和深`;
      if (offset < 0 || offset + item.w > along) return `${name} 超出了那面墙`;
      for (let d = 0; d < item.w; d++) {
        const key = `${item.side}:${offset + d}`;
        if (walls.has(key)) return `${name} 和 ${walls.get(key)} 在墙上重叠了`;
        walls.set(key, name);
      }
      continue;
    }
    if (!fits(item.x, item.y, item.w, item.h)) return `${name} 出了机房的墙`;
    for (let dx = 0; dx < item.w; dx++)
      for (let dy = 0; dy < item.h; dy++) {
        const issue = occupy(`${item.x + dx},${item.y + dy}`, name);
        if (issue) return issue;
      }
  }
  return "";
}


/** 选中的东西（r:机柜 id、i:障碍物 id）整体挪 dx、dy 格；墙上的只沿着墙挪。不检查，调用方用 planProblem 查。 */
export function moveKeys(plan: Plan, keys: Iterable<string>, dx: number, dy: number): Plan {
  const next: Plan = { ...plan, racks: { ...plan.racks }, items: plan.items.map((item) => ({ ...item })) };
  for (const key of keys) {
    const id = key.slice(2);
    if (key.startsWith("r:") && next.racks[id]) next.racks[id] = { ...next.racks[id], x: next.racks[id].x + dx, y: next.racks[id].y + dy };
    const item = key.startsWith("i:") ? next.items.find((entry) => entry.id === id) : undefined;
    if (!item) continue;
    if (!item.side) {
      item.x += dx;
      item.y += dy;
    } else if (horizontal(item.side)) item.x += dx;
    else item.y += dy;
  }
  return next;
}

/**
 * 在选中的格子上放东西：空着的格子每格放一个；merge 时放一个大的盖住全部（这些格子要正好拼成一个都空着的矩形，最大 20×20）。
 * 机柜和已有的东西占着的、出了机房墙的格子跳过。返回新放的东西，没地方放时是空数组。
 */
export function fillCells(plan: Plan, kind: FloorItem["kind"], cells: Iterable<readonly [number, number]>, merge: boolean, makeId: () => string): Plan["items"] {
  const taken = takenCells(plan);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && (!plan.room.w || (x < plan.room.w && y < plan.room.h));
  const seen = new Set<string>();
  const free: [number, number][] = [];
  for (const [x, y] of cells) {
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (inside(x, y) && !taken.has(key)) free.push([x, y]);
  }
  free.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (merge) {
    if (!free.length || free.length !== seen.size) return [];
    const xs = free.map(([x]) => x);
    const ys = free.map(([, y]) => y);
    const [left, top] = [Math.min(...xs), Math.min(...ys)];
    const w = Math.max(...xs) - left + 1;
    const h = Math.max(...ys) - top + 1;
    if (free.length !== w * h || w > 20 || h > 20) return [];
    return [{ id: makeId(), kind, label: "", x: left, y: top, w, h, side: "" }];
  }
  return free.map(([x, y]) => ({ id: makeId(), kind, label: "", x, y, w: 1, h: 1, side: "" }));
}

/** 机房里被机柜和障碍物占着的格子，"x,y"。 */
export function takenCells(plan: Plan): Set<string> {
  const taken = new Set<string>();
  for (const [id, pos] of Object.entries(plan.racks)) if (!plan.removed.includes(id)) taken.add(`${pos.x},${pos.y}`);
  for (const item of plan.items) if (!item.side) for (let dx = 0; dx < item.w; dx++) for (let dy = 0; dy < item.h; dy++) taken.add(`${item.x + dx},${item.y + dy}`);
  return taken;
}

/** (x0,y0) 到 (x1,y1) 这块矩形里的格子。 */
export function rectCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push([x, y]);
  return out;
}

/** 拖出一块区域放东西，见 fillCells。 */
export function paintCells(plan: Plan, kind: FloorItem["kind"], x0: number, y0: number, x1: number, y1: number, merge: boolean, makeId: () => string): Plan["items"] {
  return fillCells(plan, kind, rectCells(Math.max(0, Math.min(x0, x1)), Math.max(0, Math.min(y0, y1)), Math.max(x0, x1), Math.max(y0, y1)), merge, makeId);
}

/** 第 y 排从 x 起往右的机柜和一格深的障碍物都往右挪一格，空出 (x, y)。 */
export function shiftRow(plan: Plan, x: number, y: number): Plan {
  const next: Plan = { ...plan, racks: { ...plan.racks }, items: plan.items.map((item) => ({ ...item })) };
  for (const [id, pos] of Object.entries(next.racks)) if (!next.removed.includes(id) && pos.y === y && pos.x >= x) next.racks[id] = { ...pos, x: pos.x + 1 };
  for (const item of next.items) if (!item.side && item.h === 1 && item.y === y && item.x >= x) item.x += 1;
  return next;
}
