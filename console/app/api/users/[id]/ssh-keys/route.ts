import { jsonError, readJson } from "@/lib/api";
import { addSshKey, requireSelfOrAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    requireSelfOrAdmin(request, id);
    const body = await readJson<{ name?: string; publicKey?: string }>(request);
    return Response.json(addSshKey(id, body));
  } catch (error) {
    return jsonError(error);
  }
}
