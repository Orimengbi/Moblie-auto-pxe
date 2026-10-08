import { auditRequest, jsonError, readJson } from "@/lib/api";
import { assetRows } from "@/lib/asset-view";
import { deleteAsset, getAsset, updateAsset, type AssetInput } from "@/lib/assets";
import { requireAdmin, requireUser } from "@/lib/auth";
import { uplinksOf } from "@/lib/network";
import { removeAssetFiles } from "@/lib/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const asset = getAsset(id);
  if (!asset) return jsonError(new Error("资产不存在"), 404);
  return Response.json({ ...assetRows([asset])[0], uplinks: uplinksOf(id) });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const identity = requireUser(request);
  try {
    const asset = updateAsset(id, await readJson<AssetInput>(request), identity.user.username);
    auditRequest(request, identity, { action: "修改资产", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}` });
    return Response.json(assetRows([asset])[0]);
  } catch (error) {
    auditRequest(request, identity, { action: "修改资产", targetType: "asset", targetId: id, detail: error instanceof Error ? error.message : "", ok: false });
    return jsonError(error);
  }
}

/** 只有管理员能删。连同硬件采集记录一起删，装机批次里的行留着。 */
export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const asset = deleteAsset(id);
    removeAssetFiles(id);
    auditRequest(request, identity, { action: "删除资产", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}` });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
