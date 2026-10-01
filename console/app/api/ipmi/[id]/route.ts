import { jsonError, readJson } from "@/lib/api";
import { deleteIpmi, getIpmi, updateIpmi, type IpmiInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const setting = getIpmi(id);
  if (!setting) return jsonError(new Error("IPMI 设置不存在"), 404);
  return Response.json(setting);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<IpmiInput>(request);
    return Response.json(await updateIpmi(id, body));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteIpmi(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
