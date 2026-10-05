import { jsonError, readJson } from "@/lib/api";
import { createTask, startTask, type TaskInput } from "@/lib/remote";
import { getProject, listTasks } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getProject(id)) return jsonError(new Error("项目不存在"), 404);
  return Response.json(listTasks(id));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const task = createTask(id, await readJson<TaskInput>(request));
    startTask(task);
    return Response.json(task);
  } catch (error) {
    return jsonError(error);
  }
}
