import { audited, jsonError } from "@/lib/api";
import { addEvent } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";
import { assetSession, clearLog, listLogServices, readLog } from "@/lib/bmc-redfish";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 不带 service：列出有哪些日志和条数；带 service（日志的 Redfish 路径）和 page：读一页，新的在前。 */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const service = url.searchParams.get("service");
    const { session } = await assetSession(id);
    if (!service) return Response.json({ services: await listLogServices(session) });
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    return Response.json(await readLog(session, service, page));
  } catch (error) {
    return jsonError(error);
  }
}

/** 清空一个日志，只有管理员能做。 */
export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const service = new URL(request.url).searchParams.get("service") || "";
    const { asset, session } = await assetSession(id);
    await audited(request, { action: "清空 BMC 日志", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail: service }, () => clearLog(session, service));
    addEvent(id, "bmc", `清空 BMC 日志 ${service.split("/").pop()}`, identity.user.username);
    return Response.json({ message: "已清空" });
  } catch (error) {
    return jsonError(error);
  }
}
