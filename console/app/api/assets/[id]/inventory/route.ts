import { jsonError } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { checkBaseline } from "@/lib/inventory";
import { getBaseline, getInventory, inventoryMeta, latestInventory, listInventory, serversOfAsset } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 一台资产的采集记录。?id= 看某一次，?source= 看某个来源最近一次；都不给时先看系统内的。?view=changes 只要变更记录。
 * 基准按 ?project= 指定的装机批次，没给时用这台最近一次装机批次的基准。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!getAsset(id)) throw new Error("资产不存在");
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "changes") {
      return Response.json({ history: listInventory(id).map((snapshot) => ({ ...inventoryMeta(snapshot), list: snapshot.changes ?? null })) });
    }
    const wanted = url.searchParams.get("id");
    const source = url.searchParams.get("source");
    const snapshot = wanted
      ? getInventory(id, wanted)
      : source === "os" || source === "bmc" || source === "snmp"
        ? latestInventory(id, source)
        : latestInventory(id, "os") || latestInventory(id, "bmc");
    const projectId = url.searchParams.get("project") || serversOfAsset(id)[0]?.projectId || "";
    const baseline = projectId ? getBaseline(projectId) : null;
    return Response.json({
      history: listInventory(id).map(inventoryMeta),
      snapshot,
      baseline,
      issues: snapshot && baseline?.source === snapshot.source ? checkBaseline(baseline.rules, snapshot.components) : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
