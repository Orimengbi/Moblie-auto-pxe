import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { createSnmpProfile, listSnmpProfiles, publicSnmpProfile, type SnmpProfileInput } from "@/lib/snmp";

export const dynamic = "force-dynamic";

/** 列表不带密码，登录了就能看（编辑资产时选）。 */
export function GET() {
  return Response.json(listSnmpProfiles().map(publicSnmpProfile));
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson<SnmpProfileInput>(request);
    const profile = await audited(request, (p) => ({ action: "新建 SNMP 凭据", targetType: "settings", targetId: p?.id, targetLabel: body.name, detail: body.version }), () => createSnmpProfile(body));
    return Response.json(publicSnmpProfile(profile), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
