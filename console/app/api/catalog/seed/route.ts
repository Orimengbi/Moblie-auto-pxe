import { audited, jsonError, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { seedCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** 导入随程序发的常见型号。dryRun 只返回会新建、补属性的型号。 */
export async function POST(request: Request) {
  try {
    requirePermission(request, "catalog");
    const body = await readJson<{ dryRun?: boolean }>(request).catch(() => ({ dryRun: false }));
    if (body.dryRun) return Response.json(seedCatalog(true));
    return Response.json(
      await audited(request, (result) => ({ action: "导入常见型号", targetType: "catalog", targetLabel: "型号字典", detail: result ? `新建 ${result.created.length}，补属性 ${result.updated.length}` : "" }), () => seedCatalog()),
    );
  } catch (error) {
    return jsonError(error);
  }
}
