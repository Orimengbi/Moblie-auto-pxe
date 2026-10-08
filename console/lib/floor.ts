import type { Rack } from "./types.ts";

/** 俯视图的排布。只做计算，不碰数据库，页面组件可以直接引用。 */

/**
 * 俯视图上每个机柜的格子：摆过的用自己的位置；没摆过的按列/排一排一行（排之间空一行当通道），
 * 放在已摆好的下面，不和它们重叠。
 */
export function floorPositions(racks: Rack[]): Map<string, { x: number; y: number; auto: boolean }> {
  const out = new Map<string, { x: number; y: number; auto: boolean }>();
  let bottom = -1;
  for (const rack of racks) {
    if (rack.posX === null || rack.posY === null) continue;
    out.set(rack.id, { x: rack.posX, y: rack.posY, auto: false });
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
    row.forEach((rack, x) => out.set(rack.id, { x, y, auto: true }));
    y += 2;
  }
  return out;
}
