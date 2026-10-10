import { audited, jsonError, readJson } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";
import { assetSession, clearBiosPending, loadSnapshot, readBios, resetBios, saveSnapshot, setBios, type BiosView } from "@/lib/bmc-redfish";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** BIOS 的全部设置项，带说明、选项和待生效的新值。平常给上次读到的；带 ?refresh=1 才去 BMC 读。 */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    if (new URL(request.url).searchParams.get("refresh") !== "1") {
      if (!getAsset(id)) throw new Error("资产不存在");
      const cached = loadSnapshot<BiosView>(id, "bios");
      return Response.json({ readAt: cached?.readAt || "", bios: cached?.data || null });
    }
    const { session } = await assetSession(id);
    const saved = saveSnapshot(id, "bios", await readBios(session));
    return Response.json({ readAt: saved.readAt, bios: saved.data });
  } catch (error) {
    return jsonError(error);
  }
}

/** 改 BIOS 设置，写进待生效，下次开机生效。只有管理员能改。 */
export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const body = await readJson<{ changes?: Record<string, unknown> }>(request);
    const changes = body.changes || {};
    const { asset, session } = await assetSession(id);
    const detail = Object.entries(changes)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", ")
      .slice(0, 1000);
    const count = await audited(request, { action: "修改 BIOS 设置", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail }, () => setBios(session, changes));
    addEvent(id, "bmc", `BIOS 设置待生效（下次开机）：${detail}`, identity.user.username);
    const saved = saveSnapshot(id, "bios", await readBios(session));
    return Response.json({ message: `${count} 项已写入，下次开机生效`, readAt: saved.readAt, bios: saved.data });
  } catch (error) {
    return jsonError(error);
  }
}

/** 撤销还没生效的修改。 */
export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const { asset, session } = await assetSession(id);
    await audited(request, { action: "撤销 BIOS 待生效设置", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}` }, () => clearBiosPending(session));
    addEvent(id, "bmc", "撤销 BIOS 待生效设置", identity.user.username);
    const saved = saveSnapshot(id, "bios", await readBios(session));
    return Response.json({ message: "已撤销", readAt: saved.readAt, bios: saved.data });
  } catch (error) {
    return jsonError(error);
  }
}

/** { action: "reset" }：恢复 BIOS 默认，下次开机生效。 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireAdmin(request);
    const body = await readJson<{ action?: string }>(request);
    if (body.action !== "reset") throw new Error("不支持的操作");
    const { asset, session } = await assetSession(id);
    await audited(request, { action: "恢复 BIOS 默认", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}` }, () => resetBios(session));
    addEvent(id, "bmc", "BIOS 恢复默认（下次开机生效）", identity.user.username);
    const saved = saveSnapshot(id, "bios", await readBios(session));
    return Response.json({ message: "已提交，下次开机恢复默认", readAt: saved.readAt, bios: saved.data });
  } catch (error) {
    return jsonError(error);
  }
}
