import { jsonError } from "@/lib/api";
import { requestReinstall, publicServer } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    return Response.json(publicServer(await requestReinstall(id, serverId)));
  } catch (error) {
    return jsonError(error);
  }
}
