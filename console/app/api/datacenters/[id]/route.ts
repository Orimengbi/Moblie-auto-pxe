import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deleteDatacenter, getDatacenter, updateDatacenter, type DatacenterInput } from "@/lib/racks";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await readJson<DatacenterInput>(request);
    return Response.json(await audited(request, { action: "修改数据中心", targetType: "datacenter", targetId: id, targetLabel: `${body.code} ${body.name}` }, () => updateDatacenter(id, body)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    // 删除统一只有管理员能做。
    requireAdmin(request);
    const { id } = await context.params;
    const datacenter = getDatacenter(id);
    await audited(request, { action: "删除数据中心", targetType: "datacenter", targetId: id, targetLabel: datacenter ? `${datacenter.code} ${datacenter.name}` : id }, () => deleteDatacenter(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
