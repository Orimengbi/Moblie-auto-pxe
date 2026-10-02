import { jsonError } from "@/lib/api";
import { parseServerTable } from "@/lib/server-sheet";
import { importServerSheet } from "@/lib/store";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择 Excel 文件");
    if (file.size > 5 * 1024 * 1024) throw new Error("规划表不能超过 5MB");
    const buffer = Buffer.from(await file.arrayBuffer());
    const book = file.name.toLowerCase().endsWith(".csv")
      ? XLSX.read(buffer.toString("utf8"), { type: "string" })
      : XLSX.read(buffer, { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error("Excel 里没有工作表");
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    const parsed = parseServerTable(rows);
    if (parsed.error) throw new Error(parsed.error);
    const result = await importServerSheet(id, parsed.records);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
