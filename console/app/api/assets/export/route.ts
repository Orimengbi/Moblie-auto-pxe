import { assetsToRows } from "@/lib/asset-sheet";
import { listAssets, listCustomers } from "@/lib/assets";
import { listRacks, listSites } from "@/lib/racks";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/** 导出全部资产，不带密码。改完可以原样导回来。 */
export function GET() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(assetsToRows(listAssets(), listCustomers(), listRacks(), listSites()));
  XLSX.utils.book_append_sheet(book, sheet, "资产");
  const body = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const day = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="assets-${day}.xlsx"`,
    },
  });
}
