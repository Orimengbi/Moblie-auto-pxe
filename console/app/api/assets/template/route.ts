import { SHEET_COLUMNS, TEMPLATE_EXAMPLE } from "@/lib/asset-sheet";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export function GET() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([SHEET_COLUMNS.map((column) => column.header), SHEET_COLUMNS.map((column) => TEMPLATE_EXAMPLE[column.field] || "")]);
  XLSX.utils.book_append_sheet(book, sheet, "资产");
  const body = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="asset-template.xlsx"',
    },
  });
}
