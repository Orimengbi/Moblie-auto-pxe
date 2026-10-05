import { jsonError } from "@/lib/api";
import { reconcileServers } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const force = new URL(request.url).searchParams.get("force") === "1";
    return Response.json(await reconcileServers(id, { force }));
  } catch (error) {
    return jsonError(error);
  }
}
