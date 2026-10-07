import { jsonError } from "@/lib/api";
import { checkBaseline } from "@/lib/inventory";
import { getBaseline, getInventory, getServer, inventoryMeta, latestInventory, listInventory } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 一台机器的采集记录。?id= 看某一次，?source= 看某个来源最近一次；都不给时先看系统内的。 */
export async function GET(request: Request, context: { params: Promise<{ id: string; serverId: string }> }) {
  try {
    const { id, serverId } = await context.params;
    if (!getServer(id, serverId)) throw new Error("这台机器不在这个项目里");
    const url = new URL(request.url);
    const wanted = url.searchParams.get("id");
    const source = url.searchParams.get("source");
    const snapshot = wanted
      ? getInventory(serverId, wanted)
      : source === "os" || source === "bmc"
        ? latestInventory(serverId, source)
        : latestInventory(serverId, "os") || latestInventory(serverId, "bmc");
    const baseline = getBaseline(id);
    return Response.json({
      history: listInventory(serverId).map(inventoryMeta),
      snapshot,
      baseline,
      issues: snapshot && baseline?.source === snapshot.source ? checkBaseline(baseline.rules, snapshot.components) : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
