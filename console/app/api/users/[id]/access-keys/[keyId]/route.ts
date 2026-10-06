import { jsonError } from "@/lib/api";
import { removeAccessKey, requireSelfOrAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; keyId: string }> }) {
  try {
    const { id, keyId } = await context.params;
    requireSelfOrAdmin(request, id);
    removeAccessKey(id, keyId);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
