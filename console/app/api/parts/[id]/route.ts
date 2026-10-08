import { audited, jsonError, readJson } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { requireAdmin, requireUser } from "@/lib/auth";
import { deletePart, getPart, listPartEvents, partLabel, updatePart, type PartEdit } from "@/lib/parts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const part = getPart(id);
  if (!part) return jsonError(new Error("备件不存在"), 404);
  const asset = part.assetId ? getAsset(part.assetId) : null;
  return Response.json({ part, events: listPartEvents(id), asset: asset ? { id: asset.id, tag: asset.tag, sn: asset.sn } : null });
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const body = await readJson<PartEdit>(request);
    const part = getPart(id);
    return Response.json(await audited(request, { action: "修改备件", targetType: "part", targetId: id, targetLabel: part ? partLabel(part) : id }, () => updatePart(id, body, identity.user.username)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    requireAdmin(request);
    const part = getPart(id);
    await audited(request, { action: "删除备件", targetType: "part", targetId: id, targetLabel: part ? partLabel(part) : id }, () => deletePart(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
