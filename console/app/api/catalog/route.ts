import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { listCatalog, saveCatalogEntry, type CatalogInput } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listCatalog());
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson<CatalogInput>(request);
    const entry = await audited(request, (made) => ({ action: "新建字典型号", targetType: "catalog", targetId: made?.id, targetLabel: `${body.vendor || ""} ${body.model || ""}`.trim() }), () => saveCatalogEntry(null, body));
    return Response.json(entry, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
