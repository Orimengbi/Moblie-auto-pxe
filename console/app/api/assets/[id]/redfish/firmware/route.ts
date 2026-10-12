import { audited, jsonError, readJson } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";
import { assetSession, firmwareInventory, loadSnapshot, pushUpdate, readTask, saveSnapshot, simpleUpdate, type FirmwareItem, type FirmwareUpdateInput } from "@/lib/bmc-redfish";
import { choiceImage, choicesForAsset } from "@/lib/firmware-lib";
import { FIRMWARE_KIND_LABEL } from "@/lib/firmware-types";
import { getMonitorState } from "@/lib/monitor";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * 固件版本清单。平常给上次读到的，不连 BMC；带 ?refresh=1 才去 BMC 读一遍并存下来（HGX 机器要十几秒）。
 * 带 task 时读那个升级任务的进度；带 library=1 给固件库里能给这台刷的包，和上次读到的开关机。
 */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const task = params.get("task");
    if (params.get("library") === "1") {
      const asset = getAsset(id);
      if (!asset) throw new Error("资产不存在");
      const state = getMonitorState(id);
      return Response.json({ choices: choicesForAsset(asset), power: state.power, powerAt: state.powerAt });
    }
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

/** 从固件库推给 BMC 刷写的请求。 */
interface PushRequest {
  packageId: string;
  image: string;
  targets: string[];
  oem: Record<string, unknown>;
  prepareHmc?: boolean;
}

/**
 * 升级固件。只有管理员能做。
 * 带 packageId：控制台把固件库里的镜像直接推给 BMC（multipart），BMC 不用能访问控制台；
 * 否则让 BMC 从网址自己下载（SimpleUpdate）。
 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const body = await readJson<FirmwareUpdateInput & Partial<PushRequest>>(request);
    if (body.packageId) {
      const { pkg, file } = choiceImage(body.packageId, String(body.image || ""));
      const targets = Array.isArray(body.targets) ? body.targets.map(String).filter(Boolean) : [];
      const oem = body.oem && typeof body.oem === "object" && !Array.isArray(body.oem) ? body.oem : {};
      const { asset, session } = await assetSession(id);
      const detail = `${FIRMWARE_KIND_LABEL[pkg.kind]} ${pkg.version}（${pkg.fileName} / ${body.image}），Targets ${JSON.stringify(targets)}，Oem ${JSON.stringify(oem)}`;
      const task = await audited(request, { action: "BMC 固件升级", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail }, () =>
        pushUpdate(session, { file, fileName: String(body.image).split("/").pop() || pkg.fileName, targets, oem, prepareHmc: Boolean(body.prepareHmc) }),
      );
      addEvent(id, "bmc", `从固件库推送升级：${detail}`, identity.user.username);
      return Response.json({ message: "镜像已传给 BMC，正在刷写", task });
    }
    const { asset, session } = await assetSession(id);
    const detail = `${body.component || "自动识别"} ${body.imageUri}`;
    const task = await audited(request, { action: "BMC 固件升级", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail }, () => simpleUpdate(session, body));
    addEvent(id, "bmc", `提交固件升级：${detail}`, identity.user.username);
    return Response.json({ message: "已提交，BMC 正在下载固件", task });
  } catch (error) {
    return jsonError(error);
  }
}
