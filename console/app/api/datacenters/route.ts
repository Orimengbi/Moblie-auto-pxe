import { audited, jsonError, readJson } from "@/lib/api";
import { createDatacenter, listDatacenters, type DatacenterInput } from "@/lib/racks";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listDatacenters());
}

export async function POST(request: Request) {
  try {
    const body = await readJson<DatacenterInput>(request);
    const datacenter = await audited(request, (d) => ({ action: "新建数据中心", targetType: "datacenter", targetId: d?.id, targetLabel: `${body.code} ${body.name}` }), () => createDatacenter(body));
    return Response.json(datacenter, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
