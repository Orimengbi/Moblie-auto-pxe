import { audited, jsonError, readJson } from "@/lib/api";
import { getSite, saveLayout, type LayoutItem } from "@/lib/racks";

export const dynamic = "force-dynamic";

/** 保存俯视图布局：{ items: [{ id, x, y, facing }] }，x、y 给 null 回到自动排布。 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ items?: LayoutItem[] }>(request);
    const items = Array.isArray(body.items) ? body.items : [];
    return Response.json(
      await audited(request, { action: "修改机房布局", targetType: "site", targetId: id, targetLabel: getSite(id)?.name, detail: `${items.length} 个机柜` }, () => saveLayout(id, items)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
