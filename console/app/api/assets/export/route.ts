import { xlsxResponse } from "@/lib/api";
import { assetsToRows } from "@/lib/asset-sheet";
import { listAssets, listCustomers } from "@/lib/assets";
import { listDatacenters, listRacks, listSites } from "@/lib/racks";
import { listSnmpProfiles } from "@/lib/snmp";

export const dynamic = "force-dynamic";

/** 导出全部资产，不带密码。改完可以原样导回来。 */
export function GET() {
  return xlsxResponse(assetsToRows(listAssets(), listCustomers(), listRacks(), listSites(), listSnmpProfiles(), listDatacenters()), "资产", `assets-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
