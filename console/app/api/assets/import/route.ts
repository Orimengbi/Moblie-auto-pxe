import { auditRequest, jsonError, readSheetUpload, userOrResponse } from "@/lib/api";
import { parseAssetTable } from "@/lib/asset-sheet";
import { importAssets } from "@/lib/assets";
import { enrichRecords } from "@/lib/bmc-identify";

export const dynamic = "force-dynamic";

/** Excel 批量导入资产。dryRun=1 只预览，不写入。序列号可以不填，有 BMC 地址和账号密码就从 BMC 读。 */
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
    // 只填了 BMC 地址和账号密码的行：连 BMC 读序列号、厂商、型号、BMC MAC，补进空格子。读不到又没序列号的算出错。
    const enriched = await enrichRecords(parsed.records);
    const usable = parsed.records.filter((record) => !enriched.get(record.row)?.error).map((record) => ({ ...record, cells: enriched.get(record.row)?.cells || record.cells }));
    const result = importAssets(usable, identity.user.username, { dryRun });
    for (const record of parsed.records) {
      const extra = enriched.get(record.row);
      if (extra?.error) {
        result.errors++;
        result.rows.push({ row: record.row, sn: "", action: "error", message: extra.error });
      } else if (extra?.note) {
        const row = result.rows.find((item) => item.row === record.row);
        if (row) row.message = [extra.note, row.message].filter(Boolean).join("\n");
      }
    }
    result.rows.sort((a, b) => a.row - b.row);
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
