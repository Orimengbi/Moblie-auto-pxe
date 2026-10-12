import { audited, jsonError, readJson } from "@/lib/api";
import { addEvent, getAsset } from "@/lib/assets";
import { requireAdmin, requireUser } from "@/lib/auth";
import { describeUserChange, type BmcUserChange } from "@/lib/ipmi-user-types";
import { applyUserChange, cleanUserChange, listIpmiUsers } from "@/lib/ipmi-users";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 这台 BMC 上的 IPMI 用户（16 个槽位），和控制台登录用的是哪个。 */
export async function GET(request: Request, context: Context) {
  try {
    requireUser(request);
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    return Response.json(await listIpmiUsers(asset));
  } catch (error) {
    return jsonError(error);
  }
}

/** 新建或更新、改密码、改权限、启用、停用、删除。管理员才能做。 */
export async function POST(request: Request, context: Context) {
  try {
    const identity = requireAdmin(request);
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    const change = cleanUserChange(await readJson<Partial<BmcUserChange>>(request));
    const done = await audited(
      request,
      { action: "改 BMC 用户", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail: describeUserChange(change) },
      () => applyUserChange(asset, change, identity.user.username),
    );
    addEvent(id, "bmc", done.join("，"), identity.user.username);
    return Response.json({ message: done.join("；"), ...(await listIpmiUsers(getAsset(id)!)) });
  } catch (error) {
    return jsonError(error);
  }
}
