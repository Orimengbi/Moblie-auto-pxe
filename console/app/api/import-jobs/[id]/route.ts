import { auditRequest, jsonError, readJson, userOrResponse } from "@/lib/api";
import { runAssetImport, type PreparedAssetImport } from "@/lib/asset-import";
import { getJob, removeJob, runInBackground, updateJob } from "@/lib/import-jobs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 一个导入任务，带预览或导入结果的每一行。 */
export async function GET(request: Request, context: Context) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const entry = getJob(id, identity.user.username);
  if (!entry) return jsonError(new Error("导入任务不存在，可能已经过期（只留 1 小时）或控制台重启过，重新上传一次"), 404);
  return Response.json(entry.job);
}

/** { action: "commit" }：按预览时准备好的数据正式写入。 */
export async function POST(request: Request, context: Context) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  try {
    const { id } = await context.params;
    const body = await readJson<{ action?: string }>(request);
    if (body.action !== "commit") throw new Error("不支持的操作");
    const entry = getJob(id, identity.user.username);
    if (!entry) throw new Error("导入任务不存在，可能已经过期，重新上传一次");
    if (entry.job.status !== "ready" || entry.job.phase !== "preview") throw new Error(entry.job.status === "running" ? "还在准备，等预览好了再确认" : "这个导入已经确认过了");
    const { job } = entry;
    const prepared = entry.payload as PreparedAssetImport;
    updateJob(id, { phase: "commit", status: "running", progress: { done: 0, total: 1, label: "正在写入" } });
    runInBackground(id, async () => {
      const result = runAssetImport(prepared, identity.user.username, false);
      updateJob(id, { status: "done", result, progress: { done: 1, total: 1, label: "导入完成" } });
      auditRequest(request, identity, {
        action: "Excel 导入资产",
        targetType: "asset",
        targetLabel: job.title,
        detail: `新建 ${result.created}，更新 ${result.updated}，没变 ${result.unchanged}，出错 ${result.errors}`,
        ok: result.errors === 0,
      });
    });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/** 从任务列表里去掉（在跑的不能去掉）。 */
export async function DELETE(request: Request, context: Context) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  return removeJob(id, identity.user.username) ? Response.json({ ok: true }) : jsonError(new Error("还在跑，或者已经没有了"));
}
