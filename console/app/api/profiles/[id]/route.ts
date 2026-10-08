import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
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
    const profile = await audited(request, { action: "修改安装配置", targetType: "profile", targetId: id, targetLabel: body.name }, () => updateProfile(id, body));
    return Response.json(publicProfile(profile));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // 删除统一只有管理员能做。
    requireAdmin(request);
    const { id } = await context.params;
    await audited(request, { action: "删除安装配置", targetType: "profile", targetId: id, targetLabel: getProfile(id)?.name }, () => deleteProfile(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
