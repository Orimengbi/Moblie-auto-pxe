import crypto from "node:crypto";

/**
 * 在后台跑的表格导入。读表、连 BMC 补信息可能要几分钟，页面上可以「最小化到任务」，
 * 右上角任务列表里看进度；预览好了再点开确认，确认时直接用预览时准备好的数据写入，不再读一遍 BMC。
 * 只放在控制台进程内存里：控制台重启就没了（表重新上传一次就行），完成的留 1 小时。
 */

export type ImportJobStatus = "running" | "ready" | "done" | "error";

export interface ImportJob<R = unknown> {
  id: string;
  /** 谁传的，只给本人看。 */
  owner: string;
  kind: "assets";
  /** 文件名。 */
  title: string;
  /** 回到哪个页面打开它，比如 /assets。 */
  page: string;
  /** preview：读表、补信息、预览；commit：正式写入。 */
  phase: "preview" | "commit";
  /** running 在跑；ready 预览好了等确认；done 写完了；error 出错了。 */
  status: ImportJobStatus;
  progress: { done: number; total: number; label: string };
  result: R | null;
  error: string;
  startedAt: string;
  updatedAt: string;
}

interface Entry {
  job: ImportJob;
  /** 预览时准备好的数据，确认时用；不给页面。 */
  payload: unknown;
}

declare global {
  var pxeImportJobs: Map<string, Entry> | undefined;
}

function store(): Map<string, Entry> {
  globalThis.pxeImportJobs ||= new Map();
  return globalThis.pxeImportJobs;
}

const KEEP_MS = 60 * 60_000;

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of store()) {
    if (entry.job.status !== "running" && now - Date.parse(entry.job.updatedAt) > KEEP_MS) store().delete(id);
  }
}

export function createJob(input: Pick<ImportJob, "owner" | "kind" | "title" | "page">): ImportJob {
  prune();
  const now = new Date().toISOString();
  const job: ImportJob = { ...input, id: crypto.randomUUID(), phase: "preview", status: "running", progress: { done: 0, total: 0, label: "正在读表" }, result: null, error: "", startedAt: now, updatedAt: now };
  store().set(job.id, { job, payload: null });
  return job;
}

export function updateJob(id: string, patch: Partial<Omit<ImportJob, "id" | "owner">>, payload?: unknown): void {
  const entry = store().get(id);
  if (!entry) return;
  entry.job = { ...entry.job, ...patch, updatedAt: new Date().toISOString() };
  if (payload !== undefined) entry.payload = payload;
}

/** 只认本人的任务。 */
export function getJob(id: string, owner: string): { job: ImportJob; payload: unknown } | null {
  const entry = store().get(id);
  return entry && entry.job.owner === owner ? entry : null;
}

/** 本人的任务，新的在前；列表里不带每一行的结果，只带计数。 */
export function listJobs(owner: string): ImportJob[] {
  prune();
  return [...store().values()]
    .map((entry) => entry.job)
    .filter((job) => job.owner === owner)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((job) => ({ ...job, result: job.result && typeof job.result === "object" ? { ...(job.result as Record<string, unknown>), rows: undefined } : job.result }));
}

export function removeJob(id: string, owner: string): boolean {
  const entry = getJob(id, owner);
  if (!entry || entry.job.status === "running") return false;
  store().delete(id);
  return true;
}

/** 在后台跑 work，出错记进任务；不等它完成。 */
export function runInBackground(id: string, work: () => Promise<void>): void {
  void work().catch((error) => updateJob(id, { status: "error", error: error instanceof Error ? error.message : "失败" }));
}
