import { jsonError, readJson } from "@/lib/api";
import { deleteScript, getScript, readScriptBody, setScriptEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const script = getScript(id);
  if (!script) return jsonError(new Error("脚本不存在"), 404);
  return Response.json({ ...script, body: readScriptBody(id) });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ enabled?: boolean }>(request);
    return Response.json(await setScriptEnabled(id, Boolean(body.enabled)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteScript(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
