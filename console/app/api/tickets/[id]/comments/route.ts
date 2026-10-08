import { jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { commentTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** 评论只记在工单里，不进审计。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const body = await readJson<{ text: string }>(request);
    commentTicket(id, body.text, identity.user.username);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
