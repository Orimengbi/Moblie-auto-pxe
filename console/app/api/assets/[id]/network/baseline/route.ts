import { audited, jsonError } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { resetPortBaseline } from "@/lib/network";

export const dynamic = "force-dynamic";

/** 重置端口基线：现在没 up 的口不再报掉线。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    return Response.json(await audited(request, { action: "重置端口基线", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}` }, () => resetPortBaseline(id)));
  } catch (error) {
    return jsonError(error);
  }
}
