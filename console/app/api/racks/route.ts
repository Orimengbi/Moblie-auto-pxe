import { audited, jsonError, readJson } from "@/lib/api";
import { createRack, createRacks, getSite, listRacks, type RackInput } from "@/lib/racks";

export const dynamic = "force-dynamic";

/** ?site= 只看一个机房的。 */
export function GET(request: Request) {
  return Response.json(listRacks(new URL(request.url).searchParams.get("site") || undefined));
}

/** 建一个机柜；给了 from/to 就按前缀加编号批量建。 */
export async function POST(request: Request) {
  try {
    const body = await readJson<RackInput & { prefix?: string; from?: number; to?: number; pad?: number }>(request);
    const site = getSite(String(body.siteId || ""));
    if (body.from !== undefined && body.to !== undefined) {
      const result = await audited(
        request,
        (r) => ({ action: "批量新建机柜", targetType: "site", targetId: site?.id, targetLabel: site?.name, detail: r ? `新建 ${r.created.map((rack) => rack.name).join(" ")}${r.skipped.length ? `；已有跳过 ${r.skipped.join(" ")}` : ""}` : "" }),
        () => createRacks(body),
      );
      return Response.json(result, { status: 201 });
    }
    const rack = await audited(request, (r) => ({ action: "新建机柜", targetType: "rack", targetId: r?.id, targetLabel: `${site?.code || ""} ${body.name}` }), () => createRack(body));
    return Response.json(rack, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
