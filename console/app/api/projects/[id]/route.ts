import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
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
      const dhcp = body.dhcp;
      return Response.json(
        await audited(request, { action: "修改装机批次 DHCP", targetType: "project", targetId: id, targetLabel: getProject(id)?.name, detail: `${dhcp.start}-${dhcp.end}` }, () =>
          updateProjectNetwork(id, { dhcp, fixed: body.fixed }),
        ),
      );
    }
    const name = body.name;
    if (name) {
      return Response.json(
        await audited(request, { action: "重命名装机批次", targetType: "project", targetId: id, targetLabel: `${getProject(id)?.name} → ${name}` }, () => renameProject(id, { name, note: body.note })),
      );
    }
    throw new Error("没有要保存的内容");
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // 删除统一只有管理员能做。
    requireAdmin(request);
    const { id } = await context.params;
    await audited(request, { action: "删除装机批次", targetType: "project", targetId: id, targetLabel: getProject(id)?.name }, () => deleteProject(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
