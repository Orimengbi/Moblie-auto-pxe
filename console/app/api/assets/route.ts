import { auditRequest, jsonError, readJson } from "@/lib/api";
import { assetRows } from "@/lib/asset-view";
import { createAsset, publicAsset, type AssetInput } from "@/lib/assets";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** ?light=1 只要编号、状态、位置（下拉框用），快很多。 */
export function GET(request: Request) {
  return Response.json(assetRows(undefined, undefined, { light: new URL(request.url).searchParams.get("light") === "1" }));
}

export async function POST(request: Request) {
  try {
    const identity = requireUser(request);
    const asset = createAsset(await readJson<AssetInput>(request), identity.user.username);
    auditRequest(request, identity, { action: "新建资产", targetType: "asset", targetId: asset.id, targetLabel: `${asset.tag} ${asset.sn}` });
    return Response.json(publicAsset(asset), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
