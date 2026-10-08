import { jsonError } from "@/lib/api";
import { getAsset, listAudit, listEvents } from "@/lib/assets";

export const dynamic = "force-dynamic";

/** 资产时间线：状态和资料变化、装机进度，加上对这台做过的操作。 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getAsset(id)) return jsonError(new Error("资产不存在"), 404);
  return Response.json({ events: listEvents(id), audit: listAudit({ targetId: id, limit: 200 }) });
}
