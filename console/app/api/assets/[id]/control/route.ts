import { auditRequest, jsonError, readJson, userOrResponse } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { resetBmc, type BmcResetVia } from "@/lib/remote";
import { controlAsset, type ServerControl } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  const asset = getAsset(id);
  const input = await readJson<ServerControl & { bmcReset?: BmcResetVia }>(request).catch(() => ({}) as ServerControl & { bmcReset?: BmcResetVia });
  const label = asset ? `${asset.tag} ${asset.sn}` : id;
  if (input.bmcReset) {
    const how = input.bmcReset === "inband" ? "带内" : "带外";
    try {
      const result = await resetBmc(id, input.bmcReset);
      auditRequest(request, identity, { action: "重启 BMC", targetType: "asset", targetId: id, targetLabel: label, detail: result.message });
      addEvent(id, "bmc", `重启 BMC（${how}）`, identity.user.username);
      return Response.json(result);
    } catch (error) {
      auditRequest(request, identity, { action: "重启 BMC", targetType: "asset", targetId: id, targetLabel: label, detail: `${how}：${error instanceof Error ? error.message : "失败"}`, ok: false });
      return jsonError(error);
    }
  }
  const detail = [input.boot && `引导 ${input.boot}${input.persistent ? "（持续）" : ""}`, input.power && `电源 ${input.power}`].filter(Boolean).join("，");
  try {
    const result = await controlAsset(id, input);
    auditRequest(request, identity, { action: "电源和引导", targetType: "asset", targetId: id, targetLabel: label, detail: result.message });
    return Response.json(result);
  } catch (error) {
    auditRequest(request, identity, { action: "电源和引导", targetType: "asset", targetId: id, targetLabel: label, detail: `${detail}：${error instanceof Error ? error.message : "失败"}`, ok: false });
    return jsonError(error);
  }
}
