import fs from "node:fs";
import path from "node:path";
import { audited, jsonError, readJson } from "@/lib/api";
import { addEvent } from "@/lib/assets";
import { requireUser } from "@/lib/auth";
import { assetSession, bmcOverview, changeSystem, type SystemChange } from "@/lib/bmc-redfish";
import { bootOrigin } from "@/lib/net";
import { imageDir } from "@/lib/paths";
import { streamStatus } from "@/lib/redfish-events";
import { getState, installServerIp, listImages } from "@/lib/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 控制台上 ISO 的下载地址。只有装机网里的 BMC 能访问。 */
function isoChoices(): { name: string; url: string }[] {
  try {
    const network = getState().network;
    const origin = bootOrigin(installServerIp(network), network.httpPort);
    return listImages()
      .filter((image) => image.status === "ready" && fs.existsSync(path.join(imageDir(image.id), "source.iso")))
      .map((image) => ({ name: image.name, url: `${origin}/images/${image.id}/source.iso` }));
  } catch {
    return [];
  }
}

/** 这台 BMC 的概况：电源、引导、定位灯、虚拟介质、功耗、固件升级状态。 */
export async function GET(_: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { session } = await assetSession(id);
    return Response.json({ ...(await bmcOverview(session)), isos: isoChoices(), events: streamStatus(id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requireUser(request);
    const body = await readJson<SystemChange>(request);
    const { asset, session } = await assetSession(id);
    const done = await audited(request, (result: string[] | null) => ({ action: "BMC 设置", targetType: "asset", targetId: id, targetLabel: `${asset.tag} ${asset.sn}`, detail: result ? result.join("，") : JSON.stringify(body).slice(0, 300) }), () => changeSystem(session, body));
    if (body.bootOrder || body.assetTag !== undefined) addEvent(id, "bmc", done.join("，"), identity.user.username);
    return Response.json({ message: done.join("，") });
  } catch (error) {
    return jsonError(error);
  }
}
