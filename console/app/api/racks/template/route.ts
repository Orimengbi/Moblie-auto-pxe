import { RACK_SHEET_HEADERS } from "@/lib/racks";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export function GET() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    RACK_SHEET_HEADERS,
    ["SZ1", "A01", "A", "42", "12kW", "示例，导入前删掉"],
    ["SZ1", "B01", "B", "48", "", ""],
  ]);
  XLSX.utils.book_append_sheet(book, sheet, "机柜");
  const body = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(body), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="rack-template.xlsx"' },
  });
}
