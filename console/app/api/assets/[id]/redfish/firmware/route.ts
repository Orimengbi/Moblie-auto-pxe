import { audited, jsonError, readJson } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";
import { assetSession, firmwareInventory, loadSnapshot, readTask, saveSnapshot, simpleUpdate, type FirmwareItem, type FirmwareUpdateInput } from "@/lib/bmc-redfish";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * 固件版本清单。平常给上次读到的，不连 BMC；带 ?refresh=1 才去 BMC 读一遍并存下来（HGX 机器要十几秒）。
 * 带 task 时读那个升级任务的进度。
 */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const task = params.get("task");
    if (!task && params.get("refresh") !== "1") {
      if (!getAsset(id)) throw new Error("资产不存在");
      const cached = loadSnapshot<FirmwareItem[]>(id, "firmware");
      return Response.json({ readAt: cached?.readAt || "", items: cached?.data || null });
    }
    const { session } = await assetSession(id);
    if (task) return Response.json(await readTask(session, task));
    const saved = saveSnapshot(id, "firmware", await firmwareInventory(session));
    return Response.json({ readAt: saved.readAt, items: saved.data });
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
