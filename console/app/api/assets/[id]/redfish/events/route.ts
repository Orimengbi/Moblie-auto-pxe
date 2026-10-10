import { jsonError } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { listBmcEvents, streamStatus } from "@/lib/redfish-events";

export const dynamic = "force-dynamic";

/** BMC 实时推来的最近事件和这台的事件流连接状态。 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getAsset(id)) return jsonError(new Error("资产不存在"), 404);
  return Response.json({ stream: streamStatus(id), events: listBmcEvents(id, 200) });
}
