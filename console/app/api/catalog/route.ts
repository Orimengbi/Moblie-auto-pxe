import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { heightChanged, listCatalog, saveCatalogEntry, syncAssetHeights, syncDetail, type CatalogInput } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listCatalog());
}

export async function POST(request: Request) {
  try {
    const identity = requireAdmin(request);
    const body = await readJson<CatalogInput>(request);
    const saved = await audited(
      request,
      (made) => ({ action: "新建字典型号", targetType: "catalog", targetId: made?.id, targetLabel: `${body.vendor || ""} ${body.model || ""}`.trim(), detail: syncDetail(made?.heightSync) }),
      () => {
        const entry = saveCatalogEntry(null, body);
        return { ...entry, heightSync: heightChanged(null, entry) ? syncAssetHeights(entry, identity.user.username) : null };
      },
    );
    return Response.json(saved, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
