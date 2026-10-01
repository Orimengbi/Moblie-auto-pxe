import { jsonError } from "@/lib/api";
import { deleteMachine } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function DELETE(_: Request, context: { params: Promise<{ mac: string }> }) {
  try {
    const { mac } = await context.params;
    await deleteMachine(decodeURIComponent(mac));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
