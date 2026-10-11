import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deleteCatalogEntry, getCatalogEntry, saveCatalogEntry, type CatalogInput } from "@/lib/catalog";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    requireAdmin(request);
    const body = await readJson<CatalogInput>(request);
    const label = getCatalogEntry(id)?.model || id;
    return Response.json(await audited(request, { action: "修改字典型号", targetType: "catalog", targetId: id, targetLabel: label }, () => saveCatalogEntry(id, body)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    requireAdmin(request);
    const label = getCatalogEntry(id)?.model || id;
    await audited(request, { action: "删除字典型号", targetType: "catalog", targetId: id, targetLabel: label }, () => deleteCatalogEntry(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
