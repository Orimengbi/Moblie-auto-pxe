import { jsonError, readJson } from "@/lib/api";
import { createScript, listScripts } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listScripts());
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{ name?: string; body?: string }>(request);
    const script = await createScript(body.name || "", body.body || "");
    return Response.json(script, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
