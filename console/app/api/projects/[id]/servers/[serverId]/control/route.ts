import { jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { controlServer, publicServer, type ServerControl } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    const { user } = requireUser(request);
    const result = await controlServer(id, serverId, await readJson<ServerControl>(request));
    console.log(`[ipmi] ${user.username} ${result.message}`);
    return Response.json({ ...publicServer(result.row), message: result.message });
  } catch (error) {
    return jsonError(error);
  }
}
