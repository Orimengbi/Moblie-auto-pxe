import { audited, jsonError } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { reanalyzePackage } from "@/lib/firmware-lib";

export const dynamic = "force-dynamic";

/** 重新识别一个包；人改过的厂商、类型、版本、型号保留。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requirePermission(request, "firmware");
    const { id } = await context.params;
    return Response.json(await audited(request, (pkg) => ({ action: "重新识别固件包", targetType: "firmware", targetId: id, targetLabel: pkg?.fileName }), () => reanalyzePackage(id)));
  } catch (error) {
    return jsonError(error);
  }
}
