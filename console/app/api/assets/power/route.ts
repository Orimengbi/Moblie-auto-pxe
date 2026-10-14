import { powerByAsset } from "@/lib/monitor";

export const dynamic = "force-dynamic";

/** 每台上次读到的开关机状态。资产列表开着时隔一会儿拉一次，不用整页刷新也能看到开关机变化。 */
export function GET() {
  return Response.json(Object.fromEntries(powerByAsset()));
}
