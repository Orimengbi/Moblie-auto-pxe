import { auditRequest, jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { importRacks } from "@/lib/racks";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/** Excel 导入机柜。dryRun=1 只预览；siteId 是表里没有「机房」列时用的机房。 */
export async function POST(request: Request) {
  const identity = requireUser(request);
  try {
    const form = await request.formData();
    const file = form.get("file");
    const dryRun = form.get("dryRun") === "1";
    if (!(file instanceof File)) throw new Error("请选择 Excel 文件");
    if (file.size > 5 * 1024 * 1024) throw new Error("表格不能超过 5MB");
    const buffer = Buffer.from(await file.arrayBuffer());
    const book = file.name.toLowerCase().endsWith(".csv") ? XLSX.read(buffer.toString("utf8"), { type: "string", raw: true }) : XLSX.read(buffer, { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error("Excel 里没有工作表");
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
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
