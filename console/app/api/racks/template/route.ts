import { xlsxResponse } from "@/lib/api";
import { RACK_SHEET_HEADERS } from "@/lib/racks";

export const dynamic = "force-dynamic";

export function GET() {
  return xlsxResponse(
    [
      RACK_SHEET_HEADERS,
      ["SZ1", "A01", "A", "42", "12kW", "上", "", "示例，导入前删掉"],
      ["SZ1", "A02", "A", "42", "12kW", "上", "是", "不可用的写「是」，原因写备注"],
      ["SZ1", "B01", "B", "48", "", "下", "", ""],
    ],
    "机柜",
    "rack-template.xlsx",
  );
}
