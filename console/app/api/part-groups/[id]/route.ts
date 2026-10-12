import { audited, jsonError, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { deletePartGroup, getPartGroup, savePartGroup, type PartGroupInput } from "@/lib/part-groups";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    requirePermission(request, "catalog");
    const body = await readJson<PartGroupInput>(request);
    const label = getPartGroup(id)?.name || id;
    return Response.json(await audited(request, (saved) => ({ action: "修改替换组", targetType: "part-group", targetId: id, targetLabel: label, detail: saved ? saved.models.join("、") : "" }), () => savePartGroup(id, body)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    requirePermission(request, "catalog");
    const label = getPartGroup(id)?.name || id;
    await audited(request, { action: "删除替换组", targetType: "part-group", targetId: id, targetLabel: label }, () => deletePartGroup(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
