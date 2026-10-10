import { audited, jsonError, readJson } from "@/lib/api";
import { addEvent } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";
import { assetSession, clearBiosPending, readBios, resetBios, setBios } from "@/lib/bmc-redfish";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** BIOS 的全部设置项，带说明、选项和待生效的新值。 */
export async function GET(_: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { session } = await assetSession(id);
    return Response.json(await readBios(session));
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
    return Response.json({ message: `${count} 项已写入，下次开机生效`, bios: await readBios(session) });
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
    return Response.json({ message: "已撤销", bios: await readBios(session) });
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
    return Response.json({ message: "已提交，下次开机恢复默认" });
  } catch (error) {
    return jsonError(error);
  }
}
