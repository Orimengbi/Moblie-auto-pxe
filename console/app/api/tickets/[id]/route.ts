import { audited, jsonError, readJson } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { requireUser } from "@/lib/auth";
import { getTicket, listTicketLogs, partsOfTicket, updateTicket, type TicketInput } from "@/lib/tickets";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const ticket = getTicket(id);
  if (!ticket) return jsonError(new Error("工单不存在"), 404);
  const asset = ticket.assetId ? getAsset(ticket.assetId) : null;
  return Response.json({ ticket, logs: listTicketLogs(id), parts: partsOfTicket(id), asset: asset ? { id: asset.id, tag: asset.tag, sn: asset.sn, status: asset.status } : null });
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const body = await readJson<TicketInput>(request);
    const ticket = getTicket(id);
    return Response.json(
      await audited(request, { action: "修改工单", targetType: ticket?.assetId ? "asset" : "ticket", targetId: ticket?.assetId || id, targetLabel: ticket ? `${ticket.no} ${ticket.title}` : id }, () =>
        updateTicket(id, body, identity.user.username),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
