import { jsonError, readJson } from "@/lib/api";
import { deleteProject, getProject, renameProject, updateProjectNetwork, type ProjectInput, type ProjectNetworkInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) return jsonError(new Error("项目不存在"), 404);
  return Response.json(project);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<Partial<ProjectInput & ProjectNetworkInput>>(request);
    if (body.dhcp) {
      return Response.json(await updateProjectNetwork(id, { dhcp: body.dhcp, fixed: body.fixed }));
    }
    if (body.name) return Response.json(await renameProject(id, { name: body.name, note: body.note }));
    throw new Error("没有要保存的内容");
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteProject(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
