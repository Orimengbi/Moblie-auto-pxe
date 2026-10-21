import { auditRequest, jsonError, readJson } from "@/lib/api";
import { fillAssetFromBmc } from "@/lib/asset-import";
import { assetRows } from "@/lib/asset-view";
import { createAsset, publicAsset, type AssetInput } from "@/lib/assets";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** ?light=1 只要编号、状态、位置（下拉框用），快很多。 */
export function GET(request: Request) {
  return Response.json(assetRows(undefined, undefined, { light: new URL(request.url).searchParams.get("light") === "1" }));
}

/**
 * 单台入库。填了 BMC 地址和账号密码时序列号可以不填，从 BMC 读；填了就核对，
 * 对不上返回 409 和两边的序列号，页面让人选：改用 BMC 的重新提交，或带 keepSn 坚持用填的。
 */
export async function POST(request: Request) {
  try {
    const identity = requireUser(request);
    const { keepSn, ...input } = await readJson<AssetInput & { keepSn?: boolean }>(request);
    const prepared = await fillAssetFromBmc(input, Boolean(keepSn));
    if ("mismatch" in prepared) {
      const { entered, bmc, via } = prepared.mismatch;
      return Response.json({ error: `序列号对不上：填的是 ${entered}，BMC（${via}）报的是 ${bmc}`, snMismatch: prepared.mismatch }, { status: 409 });
    }
    const asset = createAsset(prepared.input, identity.user.username);
    auditRequest(request, identity, {
      action: "新建资产",
      targetType: "asset",
      targetId: asset.id,
      targetLabel: `${asset.tag} ${asset.sn}`,
      detail: keepSn ? "BMC 报的序列号不一样，确认按填的入库" : prepared.note || undefined,
    });
    return Response.json(publicAsset(asset), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
