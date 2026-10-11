import { jsonError } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { readSensors } from "@/lib/ipmi-sensors";

export const dynamic = "force-dynamic";

/** 经 IPMI 读这台的整张传感器表：读数、状态、阈值。每次都连 BMC，两三秒。 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    return Response.json(await readSensors(asset));
  } catch (error) {
    return jsonError(error);
  }
}
