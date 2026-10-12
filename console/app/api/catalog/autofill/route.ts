import { audited, jsonError, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { autofillCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** 按硬件采集和资产表补全字典。dryRun 只返回会新建、补属性的型号。 */
export async function POST(request: Request) {
  try {
    requirePermission(request, "catalog");
    const body = await readJson<{ dryRun?: boolean }>(request).catch(() => ({ dryRun: false }));
    if (body.dryRun) return Response.json(autofillCatalog(true));
    return Response.json(
      await audited(request, (result) => ({ action: "按采集补全字典", targetType: "catalog", targetLabel: "型号字典", detail: result ? `新建 ${result.created.length}，补属性 ${result.updated.length}` : "" }), () => autofillCatalog()),
    );
  } catch (error) {
    return jsonError(error);
  }
}
