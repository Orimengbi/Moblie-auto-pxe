import { audited, jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { partLabel } from "@/lib/parts";
import { getTicket, replacePart, type ReplaceInput } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const body = await readJson<ReplaceInput>(request);
    const ticket = getTicket(id);
    return Response.json(
      await audited(
        request,
        (r) => ({
          action: "工单换件",
          targetType: "asset",
          targetId: ticket?.assetId || undefined,
          targetLabel: ticket ? `${ticket.no} ${ticket.title}` : id,
          detail: r ? `${r.removed ? partLabel(r.removed) : "无旧件"} → ${r.installed ? partLabel(r.installed) : "无新件"}` : `${body.oldSn || ""} → ${body.newSn || body.newPartId || ""}`,
        }),
        () => replacePart(id, body, identity.user.username),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
