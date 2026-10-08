import { auditRequest, auditTask, jsonError, readJson, userOrResponse } from "@/lib/api";
import { createTask, startTask, type TaskInput } from "@/lib/remote";
import { listImages, listAllTasks, listProjects } from "@/lib/store";
import type { TaskFeed, TaskSummary } from "@/lib/types";
import { listUploadSessions } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** 右上角任务列表用：所有项目的批量任务、正在抽取的镜像、服务器上没传完的上传。 */
export function GET() {
  const projects = new Map(listProjects().map((project) => [project.id, project.name]));
  const tasks: TaskSummary[] = listAllTasks()
    .filter((task, index) => task.status === "running" || index < 10)
    .map((task) => {
      const by = (...status: string[]) => task.targets.filter((target) => status.includes(target.status)).length;
      return {
        id: task.id,
        projectId: task.projectId,
        projectName: task.projectId ? projects.get(task.projectId) || task.projectId : "",
        kind: task.kind,
        name: task.name,
        status: task.status,
        total: task.targets.length,
        ok: by("ok"),
        failed: by("failed", "timeout", "unreachable"),
        createdAt: task.createdAt,
        finishedAt: task.finishedAt,
      };
    });
  const feed: TaskFeed = {
    tasks,
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
    const task = createTask(await readJson<TaskInput>(request));
    startTask(task);
    auditTask(request, identity, task);
    return Response.json(task);
  } catch (error) {
    auditRequest(request, identity, { action: "发起任务", targetType: "task", detail: error instanceof Error ? error.message : "", ok: false });
    return jsonError(error);
  }
}
