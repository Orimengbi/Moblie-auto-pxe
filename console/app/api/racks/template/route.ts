import { xlsxResponse } from "@/lib/api";
import { RACK_SHEET_HEADERS } from "@/lib/racks";

export const dynamic = "force-dynamic";

export function GET() {
  return xlsxResponse(
    [
      RACK_SHEET_HEADERS,
      ["SZ1", "A01", "A", "42", "12kW", "示例，导入前删掉"],
      ["SZ1", "B01", "B", "48", "", ""],
    ],
    "机柜",
    "rack-template.xlsx",
  );
}
