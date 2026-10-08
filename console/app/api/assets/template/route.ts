import { xlsxResponse } from "@/lib/api";
import { SHEET_COLUMNS, TEMPLATE_EXAMPLE } from "@/lib/asset-sheet";

export const dynamic = "force-dynamic";

export function GET() {
  return xlsxResponse([SHEET_COLUMNS.map((column) => column.header), SHEET_COLUMNS.map((column) => TEMPLATE_EXAMPLE[column.field] || "")], "资产", "asset-template.xlsx");
}
