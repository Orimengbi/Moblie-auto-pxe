import { jsonError, readJson } from "@/lib/api";
import { setProjectEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ enabled?: boolean }>(request);
    return Response.json(await setProjectEnabled(id, Boolean(body.enabled)));
  } catch (error) {
    return jsonError(error);
  }
}
