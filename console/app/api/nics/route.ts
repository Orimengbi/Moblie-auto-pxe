import { jsonError, readJson } from "@/lib/api";
import { createNic, type NicInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson<NicInput>(request);
    return Response.json(await createNic(body), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
