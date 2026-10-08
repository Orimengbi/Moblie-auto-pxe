import { auditRequest, jsonError } from "@/lib/api";
import { parseAssetTable } from "@/lib/asset-sheet";
import { importAssets } from "@/lib/assets";
import { requireUser } from "@/lib/auth";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/** Excel 批量导入资产。dryRun=1 只预览，不写入。 */
export async function POST(request: Request) {
  const identity = requireUser(request);
  try {
    const form = await request.formData();
    const file = form.get("file");
    const dryRun = form.get("dryRun") === "1";
    if (!(file instanceof File)) throw new Error("请选择 Excel 文件");
    if (file.size > 10 * 1024 * 1024) throw new Error("表格不能超过 10MB");
    const buffer = Buffer.from(await file.arrayBuffer());
    // CSV 全按文字读，免得日期和长序列号被转成数字。
    const book = file.name.toLowerCase().endsWith(".csv") ? XLSX.read(buffer.toString("utf8"), { type: "string", raw: true }) : XLSX.read(buffer, { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error("Excel 里没有工作表");
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];
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
