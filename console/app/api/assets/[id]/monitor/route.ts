import { audited, jsonError, readJson } from "@/lib/api";
import { listAlerts } from "@/lib/alerts";
import { getAsset } from "@/lib/assets";
import { getMonitorSettings, getMonitorState } from "@/lib/monitor";
import { checkAsset } from "@/lib/monitor-runner";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asset = getAsset(id);
  if (!asset) return jsonError(new Error("资产不存在"), 404);
  const settings = getMonitorSettings();
  return Response.json({ state: getMonitorState(id), alerts: listAlerts({ assetId: id, resolvedLimit: 20 }), monitored: settings.enabled && settings.statuses.includes(asset.status) });
}

/** 立即检查一台。body 里 bmc、os 可以只要一边，默认两边都查。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    const body = await readJson<{ bmc?: boolean; os?: boolean }>(request).catch(() => ({}) as { bmc?: boolean; os?: boolean });
    const parts = { bmc: body.bmc !== false, os: body.os !== false };
    const state = await audited(request, { action: "立即检查监控", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}` }, () => checkAsset(asset, getMonitorSettings(), parts));
    return Response.json({ state, alerts: listAlerts({ assetId: id, resolvedLimit: 20 }) });
  } catch (error) {
    return jsonError(error);
  }
}
