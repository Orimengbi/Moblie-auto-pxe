import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { baselineFromServer, deleteBaseline, getBaseline, getProject, saveBaseline } from "@/lib/store";
import type { InventorySource } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getProject(id)) return jsonError(new Error("项目不存在"), 404);
  return Response.json(getBaseline(id));
}

/** 用一台机器最近一次的采集生成基准，替换原来的。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ assetId?: string; serverId?: string; source: InventorySource }>(request);
    const assetId = body.assetId || body.serverId || "";
    return Response.json(await audited(request, { action: "生成批次基准", targetType: "project", targetId: id, targetLabel: getProject(id)?.name, detail: `按资产 ${assetId}` }, () => baselineFromServer(id, assetId, body.source === "bmc" ? "bmc" : "os")));
  } catch (error) {
    return jsonError(error);
  }
}

/** 保存改过的基准。 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ source?: InventorySource; rules?: unknown }>(request);
    return Response.json(await audited(request, { action: "修改批次基准", targetType: "project", targetId: id, targetLabel: getProject(id)?.name }, () => saveBaseline(id, body)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // 删除统一只有管理员能做。
    requireAdmin(request);
    const { id } = await context.params;
    if (!getProject(id)) throw new Error("项目不存在");
    await audited(request, { action: "删除批次基准", targetType: "project", targetId: id, targetLabel: getProject(id)?.name }, () => deleteBaseline(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
