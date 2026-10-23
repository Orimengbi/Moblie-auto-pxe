import crypto from "node:crypto";
import type { SheetCells } from "./asset-sheet.ts";
import { findAssetBySn, importAssets, type AssetInput, type ImportResult } from "./assets.ts";
import { enrichRecords, enrichRow, identifyBmc, type Enriched } from "./bmc-identify.ts";
import { writeTask } from "./store.ts";
import type { RemoteTask } from "./types.ts";

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

const ROW_ACTION = { create: "新建", update: "更新", same: "没变", error: "出错" } as const;

/**
 * 正式写入后在任务中心记一条「Excel 导入」，一行一条结果：新建、更新、没变算成功，出错算没成功。
 * 对上资产的行能点进资产；出错又没对上的行用行号占位。主机一栏写行号。
 */
export function recordImportTask(title: string, actor: string, result: ImportResult, startedAt: string, now = new Date().toISOString()): RemoteTask {
  const task: RemoteTask = {
    id: crypto.randomUUID(),
    projectId: "",
    kind: "import",
    name: `Excel 导入 ${title}`.slice(0, 80),
    script: "",
    fileIds: [],
    concurrency: 1,
    timeoutSec: 0,
    status: "done",
    targets: result.rows.map((row) => {
      const asset = row.sn && row.action !== "error" ? findAssetBySn(row.sn) : null;
      return {
        serverId: asset?.id || `row-${row.row}`,
        sn: row.sn,
        host: `第 ${row.row} 行`,
        hostSource: "",
        status: row.action === "error" ? "failed" : "ok",
        exitCode: null,
        output: [ROW_ACTION[row.action], row.message].filter(Boolean).join("：") || ROW_ACTION[row.action],
        startedAt,
        finishedAt: now,
      };
    }),
    createdBy: actor,
    createdAt: startedAt,
    finishedAt: now,
  };
  writeTask(task);
  return task;
}

/** 单台入库时填的序列号和 BMC 报的对不上。 */
export type SnMismatch = NonNullable<Enriched["mismatch"]>;

const BMC_FILLED = ["sn", "vendor", "model", "bmcMac", "hostname"] as const;

/**
 * 单台入库：填了 BMC 地址和账号密码就先连 BMC，没填序列号用 BMC 报的，空着的厂商、型号、BMC MAC、主机名一起补上。
 * 填了序列号就核对，对不上返回 mismatch 让人选；keepSn 是看过提示后坚持用填的，这时不连 BMC，也不补别的。
 */
export async function fillAssetFromBmc(
  input: AssetInput,
  keepSn: boolean,
  identify: typeof identifyBmc = identifyBmc,
): Promise<{ input: AssetInput; note: string } | { mismatch: SnMismatch }> {
  if (keepSn) return { input, note: "" };
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const cells: SheetCells = {};
  for (const key of [...BMC_FILLED, "bmcIp", "bmcUser", "bmcPassword", "bmcFallbackUser", "bmcFallbackPassword"] as const) cells[key] = text(input[key]);
  const result = await enrichRow(cells, identify);
  if (result.mismatch) return { mismatch: result.mismatch };
  if (result.error) throw new Error(result.error);
  const filled: AssetInput = { ...input };
  for (const key of BMC_FILLED) if (result.cells[key]) filled[key] = result.cells[key];
  return { input: filled, note: result.note };
}
