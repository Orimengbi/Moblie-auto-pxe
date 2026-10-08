import { audited, jsonError } from "@/lib/api";
import { getServer, requestReinstall, publicServer } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    const row = getServer(id, serverId);
    return Response.json(publicServer(await audited(request, { action: "重装", targetType: "asset", targetId: row?.assetId, targetLabel: row?.sn, detail: row?.osName }, () => requestReinstall(id, serverId))));
  } catch (error) {
    return jsonError(error);
  }
}
