import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deleteSnmpProfile, getSnmpProfile, publicSnmpProfile, updateSnmpProfile, type SnmpProfileInput } from "@/lib/snmp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    requireAdmin(request);
    const body = await readJson<SnmpProfileInput>(request);
    const profile = await audited(request, { action: "修改 SNMP 凭据", targetType: "settings", targetId: id, targetLabel: getSnmpProfile(id)?.name }, () => updateSnmpProfile(id, body));
    return Response.json(publicSnmpProfile(profile));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    requireAdmin(request);
    await audited(request, { action: "删除 SNMP 凭据", targetType: "settings", targetId: id, targetLabel: getSnmpProfile(id)?.name }, () => deleteSnmpProfile(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
