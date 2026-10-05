import { jsonError } from "@/lib/api";
import { deleteFile } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteFile(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
