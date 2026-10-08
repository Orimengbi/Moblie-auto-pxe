import { audited, jsonError } from "@/lib/api";
import { alertToTicket, getAlert } from "@/lib/alerts";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await context.params).id);
    const identity = requireUser(request);
    const alert = getAlert(id);
    return Response.json(
      await audited(request, (t) => ({ action: "告警转工单", targetType: "asset", targetId: alert?.assetId, targetLabel: t ? `${t.no} ${t.title}` : alert?.title }), () => alertToTicket(id, identity.user.username)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
