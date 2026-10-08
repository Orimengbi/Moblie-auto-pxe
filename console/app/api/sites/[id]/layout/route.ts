import { audited, jsonError, readJson } from "@/lib/api";
import { getSite, saveLayout, type LayoutItem } from "@/lib/racks";
import type { FloorItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 保存俯视图布局：{ items: [{ id, x, y, facing }], obstacles?: [{ kind, label, x, y, w, h }] }。x、y 给 null 回到自动排布；给了 obstacles 就整体替换障碍物。 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ items?: LayoutItem[]; obstacles?: Omit<FloorItem, "id" | "siteId">[] }>(request);
    const items = Array.isArray(body.items) ? body.items : [];
    const obstacles = Array.isArray(body.obstacles) ? body.obstacles : undefined;
    return Response.json(
      await audited(request, { action: "修改机房布局", targetType: "site", targetId: id, targetLabel: getSite(id)?.name, detail: `${items.length} 个机柜${obstacles ? `，${obstacles.length} 个障碍物` : ""}` }, () => saveLayout(id, items, obstacles)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
