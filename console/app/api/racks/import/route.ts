import { auditRequest, jsonError, readSheetUpload, userOrResponse } from "@/lib/api";
import { importRacks } from "@/lib/racks";

export const dynamic = "force-dynamic";

/** Excel 导入机柜。dryRun=1 只预览；siteId 是表里没有「机房」列时用的机房。 */
export async function POST(request: Request) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  try {
    const { form, file, rows } = await readSheetUpload(request, { maxMB: 5, raw: false });
    const dryRun = form.get("dryRun") === "1";
    if (rows.length > 5001) throw new Error("一次最多导入 5000 行");
    const result = importRacks(rows, String(form.get("siteId") || "") || null, { dryRun });
    if (!dryRun) {
      auditRequest(request, identity, { action: "Excel 导入机柜", targetType: "rack", targetLabel: file.name, detail: `新建 ${result.created}，更新 ${result.updated}，出错 ${result.errors}`, ok: result.errors === 0 });
    }
    return Response.json({ ...result, dryRun });
  } catch (error) {
    return jsonError(error);
  }
}
