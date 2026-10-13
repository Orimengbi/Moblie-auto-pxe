import { auditRequest, auditTask, jsonError, readJson, userOrResponse } from "@/lib/api";
import { permissionDenied, taskPermission } from "@/lib/roles";
import { createTask, publicTask, startTask, type TaskInput } from "@/lib/remote";
import { listImages } from "@/lib/store";
import { activeTaskSummaries, allTaskSummaries } from "@/lib/task-center";
import type { TaskFeed } from "@/lib/types";
import { listUploadSessions } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * 右上角任务列表用：在跑的和还没归档的批量任务、正在抽取的镜像、服务器上没传完的上传。
 * ?view=all 是任务中心用的：全部批量任务，含已归档。
 */
export function GET(request: Request) {
  if (new URL(request.url).searchParams.get("view") === "all") return Response.json({ tasks: allTaskSummaries() });
  const feed: TaskFeed = {
    tasks: activeTaskSummaries(),
    extracting: listImages()
      .filter((image) => image.status === "extracting")
      .map((image) => ({ id: image.id, name: image.name || image.filename })),
    uploads: listUploadSessions().map(({ id, filename, name, size, offset, fingerprint, updatedAt }) => ({ id, filename, name, size, offset, fingerprint, updatedAt })),
  };
  return Response.json(feed);
}

/** 对选中的资产发起批量任务（脚本、采集硬件、交付清理）。从装机批次页发起时带 projectId。 */
export async function POST(request: Request) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  try {
    const input = await readJson<TaskInput>(request);
    const permission = taskPermission(input.kind);
    if (!identity.permissions.includes(permission)) return Response.json({ error: permissionDenied(permission) }, { status: 403 });
    const task = createTask(input);
    startTask(task);
    auditTask(request, identity, task);
    return Response.json(publicTask(task));
  } catch (error) {
    auditRequest(request, identity, { action: "发起任务", targetType: "task", detail: error instanceof Error ? error.message : "", ok: false });
    return jsonError(error);
  }
}
