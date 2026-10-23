import { auditRequest, jsonError, readJson, userOrResponse } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { listProjects, listServers, planSingleInstall, profilesForProject, publicServer, reconcileServers, singleProject, type SingleInstallInput } from "@/lib/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 单台装机面板用：「单台装机」批次准备好没有、能选哪些系统、这台上次单台装到哪了，以及哪个批次正开着。 */
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    const project = await singleProject();
    const row = listServers().find((item) => item.projectId === project.id && item.assetId === id);
    const other = listProjects().find((item) => item.enabled && item.id !== project.id);
    return Response.json({
      project: { id: project.id, name: project.name, enabled: project.enabled, hasDhcp: Boolean(project.dhcp) },
      profiles: profilesForProject(project.id).map((item) => item.name),
      otherEnabled: other ? { id: other.id, name: other.name } : null,
      row: row ? publicServer(row) : null,
      // 表单默认值：上次单台装机填的，没有就用资产上记的系统地址。
      defaults: { osAddress: row?.osAddress || asset.osAddress || "", osNetmask: row?.osNetmask || asset.osNetmask || "", osGateway: row?.osGateway || "", osDns: row?.osDns || "", osNic: row?.osNic || "" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** 放进「单台装机」批次、打开开关，马上对一次账：让 BMC 从网卡启动。 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const identity = userOrResponse(request);
  if (identity instanceof Response) return identity;
  const asset = getAsset(id);
  const label = asset ? `${asset.tag} ${asset.sn}` : id;
  const input = await readJson<SingleInstallInput>(request).catch(() => ({ osName: "" }) as SingleInstallInput);
  const osName = String(input.osName || "").trim();
  try {
    const { project } = await planSingleInstall(id, { ...input, osName });
    await reconcileServers(project.id);
    const row = listServers().find((item) => item.projectId === project.id && item.assetId === id);
    auditRequest(request, identity, { action: "单台装机", targetType: "asset", targetId: id, targetLabel: label, detail: `${osName}：${row?.detail || ""}` });
    addEvent(id, "install", `单台装机「${osName}」：${row?.detail || ""}`, identity.user.username);
    return Response.json({ row: row ? publicServer(row) : null });
  } catch (error) {
    auditRequest(request, identity, { action: "单台装机", targetType: "asset", targetId: id, targetLabel: label, detail: `${osName}：${error instanceof Error ? error.message : "失败"}`, ok: false });
    return jsonError(error);
  }
}
