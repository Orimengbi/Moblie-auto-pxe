import { auditRequest, jsonError, userOrResponse } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { queryOptics } from "@/lib/remote";
import { getOptics } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 上一次查询的收发光，没查过是 null。 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!getAsset(id)) throw new Error("资产不存在");
    return Response.json(getOptics(id));
  } catch (error) {
    return jsonError(error);
  }
}

/** 现在 SSH 进系统查一次，一台二十来个口要十几秒。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  const asset = getAsset(id);
  try {
    const reading = await queryOptics(id);
    auditRequest(request, identity, { action: "查询收发光", targetType: "asset", targetId: id, targetLabel: asset ? `${asset.tag} ${asset.sn}` : id, detail: `${reading.ports.length} 个口` });
    return Response.json(reading);
  } catch (error) {
    auditRequest(request, identity, { action: "查询收发光", targetType: "asset", targetId: id, targetLabel: asset ? `${asset.tag} ${asset.sn}` : id, detail: error instanceof Error ? error.message : "", ok: false });
    return jsonError(error);
  }
}
