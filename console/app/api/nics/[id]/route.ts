import { jsonError, readJson } from "@/lib/api";
import { deleteNic, updateNic, type NicInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<NicInput>(request);
    return Response.json(await updateNic(id, body));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteNic(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
