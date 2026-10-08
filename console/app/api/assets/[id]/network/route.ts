import { audited, jsonError } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { collectNetwork, networkView } from "@/lib/network";
import { getMonitorState } from "@/lib/monitor";

export const dynamic = "force-dynamic";

/** 网络设备最近一次 SNMP 采集，和监控记下的端口状态。 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getAsset(id)) return jsonError(new Error("资产不存在"), 404);
  return Response.json({ ...networkView(id), monitor: getMonitorState(id).ports });
}

/** 现在用 SNMP 采集一次，一般几秒到半分钟。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    const snapshot = await audited(request, (s) => ({ action: "SNMP 采集", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail: s ? `${s.netPorts?.length || 0} 个端口，${s.components.length} 个部件` : asset.mgmtIp }), () =>
      collectNetwork(id, { force: true }),
    );
    return Response.json({ ...networkView(id), snapshot, monitor: getMonitorState(id).ports });
  } catch (error) {
    return jsonError(error);
  }
}
