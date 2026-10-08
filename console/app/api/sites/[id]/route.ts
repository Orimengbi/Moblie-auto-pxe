import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deleteSite, getSite, updateSite, type SiteInput } from "@/lib/racks";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await readJson<SiteInput>(request);
    return Response.json(await audited(request, { action: "修改机房", targetType: "site", targetId: id, targetLabel: `${body.code} ${body.name}` }, () => updateSite(id, body)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    // 删除统一只有管理员能做。
    requireAdmin(request);
    const { id } = await context.params;
    const site = getSite(id);
    await audited(request, { action: "删除机房", targetType: "site", targetId: id, targetLabel: site ? `${site.code} ${site.name}` : id }, () => deleteSite(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
