import { audited, jsonError, readJson } from "@/lib/api";
import { TICKET_STATUS } from "@/lib/asset-labels";
import { requireUser } from "@/lib/auth";
import { getTicket, setTicketStatus } from "@/lib/tickets";
import type { TicketStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const body = await readJson<{ status: TicketStatus; note?: string }>(request);
    const ticket = getTicket(id);
    return Response.json(
      await audited(
        request,
        { action: `工单改为「${TICKET_STATUS[body.status] || body.status}」`, targetType: ticket?.assetId ? "asset" : "ticket", targetId: ticket?.assetId || id, targetLabel: ticket ? `${ticket.no} ${ticket.title}` : id, detail: body.note },
        () => setTicketStatus(id, body.status, identity.user.username, body.note || ""),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
