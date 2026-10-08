import { audit, type AuditInput } from "./assets.ts";
import { AuthError, authenticate, clientAddress, type Identity } from "./auth.ts";
import type { RemoteTask } from "./types.ts";

export function jsonError(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : "请求失败";
  return Response.json({ error: message }, { status: error instanceof AuthError ? error.status : status });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求体不是 JSON");
  }
}

/** 记一条操作审计：谁、从哪个地址、对什么做了什么。 */
export function auditRequest(request: Request, identity: Identity | null, entry: Omit<AuditInput, "actor" | "ip">): void {
  audit({ ...entry, actor: identity?.user.username || "未登录", ip: clientAddress(request.headers) });
}

/** 批量任务的审计：一台时对象是那台资产，多台时是任务本身。 */
export function auditTask(request: Request, identity: Identity, task: RemoteTask): void {
  const kind = task.kind === "inventory" ? "采集硬件" : task.kind === "revoke" ? "交付清理" : "执行脚本";
  const sns = task.targets.map((target) => target.sn);
  auditRequest(request, identity, {
    action: `发起任务：${kind}`,
    targetType: "task",
    targetId: task.targets.length === 1 ? task.targets[0].serverId : task.id,
    targetLabel: `${task.name}（${sns.length} 台）`,
    detail: `${sns.slice(0, 50).join(" ")}${sns.length > 50 ? " …" : ""}${task.kind === "script" ? `\n${task.script.slice(0, 1500)}` : ""}`,
  });
}

type AuditEntry = Omit<AuditInput, "actor" | "ip" | "ok">;

/** 执行一个改动并记审计：成功记结果，失败记错误信息再抛出去。entry 可以按结果补对象名。 */
export async function audited<T>(request: Request, entry: AuditEntry | ((result: T | null) => AuditEntry), work: () => T | Promise<T>): Promise<T> {
  const identity = authenticate(request.headers);
  const describe = (result: T | null) => (typeof entry === "function" ? entry(result) : entry);
  try {
    const result = await work();
    auditRequest(request, identity, describe(result));
    return result;
  } catch (error) {
    const base = describe(null);
    auditRequest(request, identity, { ...base, detail: [base.detail, error instanceof Error ? error.message : "失败"].filter(Boolean).join("："), ok: false });
    throw error;
  }
}
