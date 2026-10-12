import { audited, jsonError, readJson } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { requirePermission, requireUser } from "@/lib/auth";
import { bmcEndpoint, forgetBmcCert, getBmcCert, trustSeenBmcCert } from "@/lib/bmc-tls";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function bmcHost(id: string): { label: string; endpoint: string } {
  const asset = getAsset(id);
  if (!asset) throw new Error("资产不存在");
  if (!asset.bmcIp) throw new Error("这台没有登记 BMC 地址");
  return { label: `${asset.tag} ${asset.sn}`, endpoint: bmcEndpoint(asset.bmcIp) };
}

/** 记下的 BMC 证书指纹，和最近一次因为对不上被拒的新指纹。 */
export async function GET(request: Request, context: Context) {
  try {
    requireUser(request);
    const { endpoint } = bmcHost((await context.params).id);
    return Response.json({ endpoint, cert: getBmcCert(endpoint) });
  } catch (error) {
    return jsonError(error);
  }
}

/** trust：接受被拒的新证书；forget：忘掉，下次连接重新记。 */
export async function POST(request: Request, context: Context) {
  try {
    const identity = requirePermission(request, "bmc.settings");
    const { id } = await context.params;
    const { label, endpoint } = bmcHost(id);
    const { action } = await readJson<{ action?: string }>(request);
    if (action !== "trust" && action !== "forget") throw new Error("操作不合法");
    const before = getBmcCert(endpoint);
    const detail = action === "trust" ? `接受新证书 ${before?.seenFingerprint || ""}（原来 ${before?.fingerprint || ""}）` : `忘掉记下的证书 ${before?.fingerprint || ""}`;
    await audited(request, { action: "BMC 证书", targetType: "asset", targetId: id, targetLabel: label, detail }, async () => {
      if (action === "trust") {
        if (!trustSeenBmcCert(endpoint)) throw new Error("没有被拒的新证书，不用确认");
      } else forgetBmcCert(endpoint);
    });
    addEvent(id, "bmc", action === "trust" ? "信任了 BMC 的新证书" : "忘掉了记下的 BMC 证书", identity.user.username);
    return Response.json({ message: action === "trust" ? "已信任新证书" : "已忘掉，下次连接时重新记", endpoint, cert: getBmcCert(endpoint) });
  } catch (error) {
    return jsonError(error);
  }
}
