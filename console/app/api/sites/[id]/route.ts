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
    // ?racks=1：连里面的空机柜一起删。
    const withRacks = new URL(request.url).searchParams.get("racks") === "1";
    const result = await audited(
      request,
      (done: { racks: number } | null) => ({ action: "删除机房", targetType: "site", targetId: id, targetLabel: site ? `${site.code} ${site.name}` : id, detail: done?.racks ? `连同 ${done.racks} 个机柜` : "" }),
      () => deleteSite(id, withRacks),
    );
    return Response.json({ ok: true, racks: result.racks });
  } catch (error) {
    return jsonError(error);
  }
}
