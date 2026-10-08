import { audited, jsonError, readJson } from "@/lib/api";
import { deleteRack, getRack, getSite, updateRack, type RackInput } from "@/lib/racks";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function label(rackId: string): string {
  const rack = getRack(rackId);
  return rack ? `${getSite(rack.siteId)?.code || ""} ${rack.name}` : rackId;
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await readJson<RackInput>(request);
    return Response.json(await audited(request, { action: "修改机柜", targetType: "rack", targetId: id, targetLabel: label(id) }, () => updateRack(id, body)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await audited(request, { action: "删除机柜", targetType: "rack", targetId: id, targetLabel: label(id) }, () => deleteRack(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
