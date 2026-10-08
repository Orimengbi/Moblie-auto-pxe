import { audited, jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createTicket, listTickets, ticketsOfAsset, type TicketInput } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** ?asset= 只看一台资产的。 */
export function GET(request: Request) {
  const asset = new URL(request.url).searchParams.get("asset");
  return Response.json(asset ? ticketsOfAsset(asset) : listTickets());
}

export async function POST(request: Request) {
  try {
    const identity = requireUser(request);
    const body = await readJson<TicketInput>(request);
    const ticket = await audited(request, (t) => ({ action: "新建工单", targetType: body.assetId ? "asset" : "ticket", targetId: body.assetId || t?.id, targetLabel: t ? `${t.no} ${t.title}` : body.title }), () =>
      createTicket(body, identity.user.username),
    );
    return Response.json(ticket, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
