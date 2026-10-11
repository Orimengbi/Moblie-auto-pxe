import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deleteCatalogEntry, getCatalogEntry, heightChanged, saveCatalogEntry, syncAssetHeights, syncDetail, type CatalogInput } from "@/lib/catalog";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const body = await readJson<CatalogInput>(request);
    const before = getCatalogEntry(id);
    const label = before?.model || id;
    const saved = await audited(
      request,
      (made) => ({ action: "修改字典型号", targetType: "catalog", targetId: id, targetLabel: label, detail: syncDetail(made?.heightSync) }),
      () => {
        const entry = saveCatalogEntry(id, body);
        return { ...entry, heightSync: heightChanged(before, entry) ? syncAssetHeights(entry, identity.user.username) : null };
      },
    );
    return Response.json(saved);
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
