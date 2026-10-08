import { auditRequest, jsonError, readJson, userOrResponse } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { controlAsset, type ServerControl } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  const asset = getAsset(id);
  const input = await readJson<ServerControl>(request).catch(() => ({}) as ServerControl);
  const label = asset ? `${asset.tag} ${asset.sn}` : id;
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
