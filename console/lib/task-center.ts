import { listAllTasks, listProjects, writeTask } from "./store.ts";
import type { RemoteTask, TaskSummary } from "./types.ts";

/**
 * 任务中心：所有批量任务（脚本、采集、BMC 操作、固件升级……）。
 * 结束的任务（不论成败）可以归档，归档了就不在右上角的任务列表里，任务中心照样查得到；结束满 1 小时自动归档。
 */

export const AUTO_ARCHIVE_MS = 60 * 60_000;
export const AUTO_ARCHIVER = "自动";

export function summarizeTask(task: RemoteTask, projects: Map<string, string>): TaskSummary {
  const by = (...status: string[]) => task.targets.filter((target) => status.includes(target.status)).length;
  const single = task.targets.length === 1 ? task.targets[0] : null;
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
    archivedAt: task.archivedAt,
    archivedBy: task.archivedBy,
    progress: task.status === "running" && single?.status === "running" ? single.progress : undefined,
  };
}

/** 结束满 1 小时（取消过归档的从取消时算）还没归档的，归档掉。归档时间记成满 1 小时那一刻。返回归档了几个。 */
export function autoArchive(tasks: RemoteTask[], now = Date.now()): number {
  let count = 0;
  for (const task of tasks) {
    if (task.status !== "done" || task.archivedAt) continue;
    const since = Math.max(Date.parse(task.finishedAt || task.createdAt) || 0, Date.parse(task.unarchivedAt || "") || 0);
    if (now - since < AUTO_ARCHIVE_MS) continue;
    task.archivedAt = new Date(since + AUTO_ARCHIVE_MS).toISOString();
    task.archivedBy = AUTO_ARCHIVER;
    writeTask(task);
    count++;
  }
  return count;
}

function projectNames(): Map<string, string> {
  return new Map(listProjects().map((project) => [project.id, project.name]));
}

/** 右上角任务列表：在跑的和结束了还没归档的。 */
export function activeTaskSummaries(now = Date.now()): TaskSummary[] {
  const tasks = listAllTasks();
  autoArchive(tasks, now);
  const projects = projectNames();
  return tasks.filter((task) => !task.archivedAt).map((task) => summarizeTask(task, projects));
}

/** 任务中心：全部，新的在前。 */
export function allTaskSummaries(now = Date.now()): TaskSummary[] {
  const tasks = listAllTasks();
  autoArchive(tasks, now);
  const projects = projectNames();
  return tasks.map((task) => summarizeTask(task, projects));
}

/** 归档或取消归档。还在跑的不能归档，跳过。返回改了的任务。 */
export function setArchived(ids: string[], archived: boolean, user: string, now = Date.now()): RemoteTask[] {
  const wanted = new Set(ids);
  const changed: RemoteTask[] = [];
  for (const task of listAllTasks()) {
    if (!wanted.has(task.id) || task.status !== "done" || Boolean(task.archivedAt) === archived) continue;
    if (archived) {
      task.archivedAt = new Date(now).toISOString();
      task.archivedBy = user;
    } else {
      delete task.archivedAt;
      delete task.archivedBy;
      task.unarchivedAt = new Date(now).toISOString();
    }
    writeTask(task);
    changed.push(task);
  }
  return changed;
}
