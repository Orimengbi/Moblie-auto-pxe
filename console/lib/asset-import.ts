import type { SheetCells } from "./asset-sheet.ts";
import { importAssets, type ImportResult } from "./assets.ts";
import { enrichRecords, identifyBmc } from "./bmc-identify.ts";

/**
 * 资产表格导入的两步：prepare 连 BMC 把空格子补上（慢，可以放后台），run 按补好的数据预览或写入（快）。
 * 预览和确认用同一份 prepared，确认时不再读一遍 BMC，写进去的就是预览里看到的。
 */

export interface PreparedAssetImport {
  /** 补好、可以导入的行。 */
  records: { row: number; cells: SheetCells }[];
  /** 没序列号、BMC 又读不到的行，直接算出错。 */
  failed: { row: number; error: string }[];
  /** 每行补了什么，按行号。 */
  notes: Record<number, string>;
  ignored: string[];
}

export async function prepareAssetImport(
  records: { row: number; cells: SheetCells }[],
  ignored: string[],
  onProgress?: (done: number, total: number) => void,
  identify: typeof identifyBmc = identifyBmc,
): Promise<PreparedAssetImport> {
  const enriched = await enrichRecords(records, identify, onProgress);
  const prepared: PreparedAssetImport = { records: [], failed: [], notes: {}, ignored };
  for (const record of records) {
    const extra = enriched.get(record.row);
    if (extra?.error) prepared.failed.push({ row: record.row, error: extra.error });
    else prepared.records.push({ row: record.row, cells: extra?.cells || record.cells });
    if (extra?.note) prepared.notes[record.row] = extra.note;
  }
  return prepared;
}

export function runAssetImport(prepared: PreparedAssetImport, actor: string, dryRun: boolean): ImportResult & { ignored: string[]; dryRun: boolean } {
  const result = importAssets(prepared.records, actor, { dryRun });
  for (const failure of prepared.failed) {
    result.errors++;
    result.rows.push({ row: failure.row, sn: "", action: "error", message: failure.error });
  }
  for (const row of result.rows) {
    const note = prepared.notes[row.row];
    if (note) row.message = [note, row.message].filter(Boolean).join("\n");
  }
  result.rows.sort((a, b) => a.row - b.row);
  return { ...result, ignored: prepared.ignored, dryRun };
}
