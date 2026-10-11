import { jsonError } from "@/lib/api";
import { getAsset } from "@/lib/assets";
import { lastSensors, readAndSaveSensors } from "@/lib/ipmi-sensors";

export const dynamic = "force-dynamic";

/** 上次手动读到的传感器表，没读过是 null。不连 BMC。 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!getAsset(id)) throw new Error("资产不存在");
    return Response.json(lastSensors(id));
  } catch (error) {
    return jsonError(error);
  }
}

/** 现在经 IPMI 读整张传感器表：读数、状态、阈值，存下来。两三秒。 */
export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const asset = getAsset(id);
    if (!asset) throw new Error("资产不存在");
    return Response.json(await readAndSaveSensors(asset));
  } catch (error) {
    return jsonError(error);
  }
}
