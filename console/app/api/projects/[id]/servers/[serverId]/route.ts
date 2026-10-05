import { jsonError, readJson } from "@/lib/api";
import type { ServerCells } from "@/lib/server-sheet";
import { deleteServer, publicServer, saveServer } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    return Response.json(publicServer(await saveServer(id, serverId, await readJson<ServerCells>(request))));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    await deleteServer(id, serverId);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
