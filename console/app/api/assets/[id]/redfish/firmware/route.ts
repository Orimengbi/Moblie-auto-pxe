import { audited, jsonError, readJson } from "@/lib/api";
import { addEvent } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";
import { assetSession, firmwareInventory, readTask, simpleUpdate, type FirmwareUpdateInput } from "@/lib/bmc-redfish";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 固件版本清单；带 task 时读那个升级任务的进度。 */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const task = new URL(request.url).searchParams.get("task");
    const { session } = await assetSession(id);
    if (task) return Response.json(await readTask(session, task));
    return Response.json({ items: await firmwareInventory(session) });
  } catch (error) {
    return jsonError(error);
  }
}

/** 让 BMC 从网址下载固件并刷写。只有管理员能做。 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const body = await readJson<FirmwareUpdateInput>(request);
    const { asset, session } = await assetSession(id);
    const detail = `${body.component || "自动识别"} ${body.imageUri}`;
    const task = await audited(request, { action: "BMC 固件升级", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail }, () => simpleUpdate(session, body));
    addEvent(id, "bmc", `提交固件升级：${detail}`, identity.user.username);
    return Response.json({ message: "已提交，BMC 正在下载固件", task });
  } catch (error) {
    return jsonError(error);
  }
}
