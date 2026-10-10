import { audited, jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assetSession, changeMedia, type MediaChange } from "@/lib/bmc-redfish";

export const dynamic = "force-dynamic";

/** 虚拟介质：打开/关闭远程介质，挂载、弹出镜像。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    requireUser(request);
    const body = await readJson<MediaChange>(request);
    const { asset, session } = await assetSession(id);
    const message = await audited(request, (result: string | null) => ({ action: "虚拟介质", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail: result || `${body.action} ${body.slot || ""} ${body.image || ""}` }), () => changeMedia(session, body));
    return Response.json({ message });
  } catch (error) {
    return jsonError(error);
  }
}
