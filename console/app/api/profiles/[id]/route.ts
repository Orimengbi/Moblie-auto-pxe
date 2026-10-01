import { jsonError, readJson } from "@/lib/api";
import { deleteProfile, getProfile, publicProfile, updateProfile, type ProfileInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const profile = getProfile(id);
  if (!profile) return jsonError(new Error("安装配置不存在"), 404);
  return Response.json(publicProfile(profile));
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<ProfileInput>(request);
    const profile = await updateProfile(id, body);
    return Response.json(publicProfile(profile));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteProfile(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
