import { auditRequest, jsonError, readSheetUpload, userOrResponse } from "@/lib/api";
import { parseAssetTable } from "@/lib/asset-sheet";
import { importAssets } from "@/lib/assets";

export const dynamic = "force-dynamic";

/** Excel 批量导入资产。dryRun=1 只预览，不写入。 */
export async function POST(request: Request) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  try {
    // 数字和日期给原始值：日期单元格是 Excel 序列号，parseAssetTable 再换成日期。
    const { form, file, rows } = await readSheetUpload(request, { maxMB: 10, raw: true });
    const dryRun = form.get("dryRun") === "1";
    const parsed = parseAssetTable(rows);
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.records.length > 5000) throw new Error("一次最多导入 5000 行");
    const result = importAssets(parsed.records, identity.user.username, { dryRun });
    if (!dryRun) {
      auditRequest(request, identity, {
        action: "Excel 导入资产",
        targetType: "asset",
        targetLabel: file.name,
        detail: `新建 ${result.created}，更新 ${result.updated}，没变 ${result.unchanged}，出错 ${result.errors}`,
        ok: result.errors === 0,
      });
    }
    return Response.json({ ...result, ignored: parsed.ignored, dryRun });
  } catch (error) {
    return jsonError(error);
  }
}
