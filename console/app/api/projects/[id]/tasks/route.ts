import { auditTask, jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createTask, publicTask, startTask, type TaskInput } from "@/lib/remote";
import { getProject, listTasks } from "@/lib/store";
import { atLeast, roleDenied, taskRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getProject(id)) return jsonError(new Error("项目不存在"), 404);
  return Response.json(listTasks(id).map(publicTask));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const input = await readJson<TaskInput>(request);
    const min = taskRole(input.kind);
    if (!atLeast(identity.user.role, min)) return Response.json({ error: roleDenied(min) }, { status: 403 });
    const task = createTask({ ...input, projectId: id });
    startTask(task);
    auditTask(request, identity, task);
    return Response.json(publicTask(task));
  } catch (error) {
    return jsonError(error);
  }
}
