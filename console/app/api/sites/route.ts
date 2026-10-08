import { audited, jsonError, readJson } from "@/lib/api";
import { createSite, listSites, type SiteInput } from "@/lib/racks";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listSites());
}

export async function POST(request: Request) {
  try {
    const body = await readJson<SiteInput>(request);
    const site = await audited(request, (s) => ({ action: "新建机房", targetType: "site", targetId: s?.id, targetLabel: `${body.code} ${body.name}` }), () => createSite(body));
    return Response.json(site, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
