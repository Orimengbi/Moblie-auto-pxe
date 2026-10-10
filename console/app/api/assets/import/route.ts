import { auditRequest, jsonError, readSheetUpload, userOrResponse } from "@/lib/api";
import { prepareAssetImport, runAssetImport } from "@/lib/asset-import";
import { parseAssetTable } from "@/lib/asset-sheet";
import { createJob, runInBackground, updateJob } from "@/lib/import-jobs";

export const dynamic = "force-dynamic";

/**
 * Excel 批量导入资产。dryRun=1 只预览，不写入。序列号可以不填，有 BMC 地址和账号密码就从 BMC 读。
 * background=1 时放到后台：马上返回 jobId，读 BMC 的进度和预览在 /api/import-jobs/<id> 里看，确认也在那里。
 */
export async function POST(request: Request) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  try {
    // 数字和日期给原始值：日期单元格是 Excel 序列号，parseAssetTable 再换成日期。
    const { form, file, rows } = await readSheetUpload(request, { maxMB: 10, raw: true });
    const dryRun = form.get("dryRun") === "1";
    const parsed = parseAssetTable(rows);
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.records.length > 5000) throw new Error("一次最多导入 5000 行");

    if (form.get("background") === "1") {
      const job = createJob({ owner: identity.user.username, kind: "assets", title: file.name, page: "/assets" });
      updateJob(job.id, { progress: { done: 0, total: parsed.records.length, label: `读到 ${parsed.records.length} 行，正在连 BMC 补信息` } });
      runInBackground(job.id, async () => {
        const prepared = await prepareAssetImport(parsed.records, parsed.ignored, (done, total) => updateJob(job.id, { progress: { done, total, label: `读 BMC ${done}/${total} 台` } }));
        updateJob(job.id, { status: "ready", result: runAssetImport(prepared, identity.user.username, true), progress: { done: 1, total: 1, label: "预览好了，等确认" } }, prepared);
      });
      return Response.json({ jobId: job.id });
    }

    // 只填了 BMC 地址和账号密码的行：连 BMC 读序列号、厂商、型号、BMC MAC，补进空格子。读不到又没序列号的算出错。
    const result = runAssetImport(await prepareAssetImport(parsed.records, parsed.ignored), identity.user.username, dryRun);
    if (!dryRun) {
      auditRequest(request, identity, {
        action: "Excel 导入资产",
        targetType: "asset",
        targetLabel: file.name,
        detail: `新建 ${result.created}，更新 ${result.updated}，没变 ${result.unchanged}，出错 ${result.errors}`,
        ok: result.errors === 0,
      });
    }
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
