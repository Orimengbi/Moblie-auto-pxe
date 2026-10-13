import { jsonError, readJson, xlsxResponse } from "@/lib/api";
import { buildExportSheets, EXPORT_SHEETS, type ExportSheet } from "@/lib/asset-export";
import { assetDropdowns, assetsToRows, EXPORT_COLUMNS, type SheetField } from "@/lib/asset-sheet";
import { applyDisplaySettings } from "@/lib/display-settings";
import { listAssets, listCustomers } from "@/lib/assets";
import { loadSnapshot, type FirmwareItem } from "@/lib/bmc-redfish";
import { getMonitorState } from "@/lib/monitor";
import { listDatacenters, listRacks, listSites } from "@/lib/racks";
import { listSnmpProfiles } from "@/lib/snmp";
import { latestInventory } from "@/lib/store";
import { formatTime } from "@/lib/time";
import { xlsxBook } from "@/lib/xlsx-dropdown";

export const dynamic = "force-dynamic";

/** 导出全部资产，不带密码。改完可以原样导回来。 */
export function GET() {
  const sites = listSites();
  const datacenters = listDatacenters();
  return xlsxResponse(assetsToRows(listAssets(), listCustomers(), listRacks(), sites, listSnmpProfiles(), datacenters), "资产", `assets-${new Date().toISOString().slice(0, 10)}.xlsx`, assetDropdowns(datacenters, sites));
}

interface ExportRequest {
  /** 要导的资产 id；不给就是全部。 */
  ids?: string[];
  sheets?: string[];
  /** 资产信息页要哪几列。 */
  columns?: string[];
}

/** 按选的机器和选的表导出，一张表一页。只读，登录了就能导。 */
export async function POST(request: Request) {
  try {
    const input = await readJson<ExportRequest>(request);
    const sheets = (input.sheets || []).filter((key): key is ExportSheet => EXPORT_SHEETS.some((sheet) => sheet.key === key));
    if (!sheets.length) throw new Error("至少选一张表");
    const all = listAssets();
    const wanted = Array.isArray(input.ids) ? new Set(input.ids.map(String)) : null;
    const assets = wanted ? all.filter((asset) => wanted.has(asset.id)) : all;
    if (!assets.length) throw new Error("没有要导出的机器");
    const fields = Array.isArray(input.columns) ? EXPORT_COLUMNS.map((column) => column.field).filter((field): field is SheetField => input.columns!.includes(field)) : undefined;
    if (fields && !fields.length && sheets.includes("assets")) throw new Error("资产信息至少选一列");
    applyDisplaySettings();
    const customers = listCustomers();
    const racks = listRacks();
    const sites = listSites();
    const profiles = listSnmpProfiles();
    const datacenters = listDatacenters();
    const pages = buildExportSheets(assets, sheets, {
      inventory: (id) => ({ os: latestInventory(id, "os"), bmc: latestInventory(id, "bmc") }),
      firmware: (id) => loadSnapshot<FirmwareItem[]>(id, "firmware"),
      monitor: (id) => getMonitorState(id),
      assetRows: (list) => assetsToRows(list, customers, racks, sites, profiles, datacenters, fields),
      time: (iso) => formatTime(iso),
    });
    const filename = `assets-${new Date().toISOString().slice(0, 10)}-${assets.length}台.xlsx`;
    const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new Response(new Uint8Array(xlsxBook(pages)), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
