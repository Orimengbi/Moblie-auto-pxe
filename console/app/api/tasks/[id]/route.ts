import { jsonError } from "@/lib/api";
import { getTask } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const task = getTask(id);
  if (!task) return jsonError(new Error("任务不存在"), 404);
  return Response.json(task);
}
