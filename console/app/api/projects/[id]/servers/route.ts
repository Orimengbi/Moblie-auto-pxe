import { jsonError, readJson } from "@/lib/api";
import type { ServerCells } from "@/lib/server-sheet";
import { publicServer, saveServer } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(publicServer(await saveServer(id, null, await readJson<ServerCells>(request))), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
