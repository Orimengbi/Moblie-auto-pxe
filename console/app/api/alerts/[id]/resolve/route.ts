import { audited, jsonError } from "@/lib/api";
import { resolveAlert, getAlert } from "@/lib/alerts";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await context.params).id);
    const identity = requireUser(request);
    const alert = getAlert(id);
    return Response.json(await audited(request, { action: "告警处理完", targetType: "asset", targetId: alert?.assetId, targetLabel: alert?.title }, () => resolveAlert(id, identity.user.username)));
  } catch (error) {
    return jsonError(error);
  }
}
