import { jsonError } from "@/lib/api";
import { reconcileServers } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(await reconcileServers(id));
  } catch (error) {
    return jsonError(error);
  }
}
