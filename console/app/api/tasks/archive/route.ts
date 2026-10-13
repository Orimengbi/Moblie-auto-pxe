import { auditRequest, jsonError, readJson, userOrResponse } from "@/lib/api";
import { setArchived } from "@/lib/task-center";

export const dynamic = "force-dynamic";

/** 归档或取消归档结束了的任务。只影响右上角列表显示，登录了就能做，记审计。 */
export async function POST(request: Request) {
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  try {
    const body = await readJson<{ ids?: unknown; archived?: unknown }>(request);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 1000) : [];
    if (!ids.length) throw new Error("没有选任务");
    const archived = body.archived !== false;
    const changed = setArchived(ids, archived, identity.user.username);
    if (changed.length) {
      auditRequest(request, identity, {
        action: archived ? "归档任务" : "取消归档任务",
        targetType: "task",
        targetId: changed.length === 1 ? changed[0].id : undefined,
        targetLabel: changed.length === 1 ? changed[0].name : `${changed.length} 个任务`,
        detail: changed.length > 1 ? changed.map((task) => task.name).join("、").slice(0, 500) : "",
      });
    }
    return Response.json({ changed: changed.length });
  } catch (error) {
    return jsonError(error);
  }
}
