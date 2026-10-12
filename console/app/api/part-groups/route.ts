import { audited, jsonError, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { listPartGroups, savePartGroup, seenModels, type PartGroupInput } from "@/lib/part-groups";

export const dynamic = "force-dynamic";

/** 替换组，和硬件采集里见过的型号（编辑时挑）。 */
export function GET() {
  return Response.json({ groups: listPartGroups(), seen: seenModels() });
}

export async function POST(request: Request) {
  try {
    requirePermission(request, "catalog");
    const body = await readJson<PartGroupInput>(request);
    const group = await audited(request, (made) => ({ action: "新建替换组", targetType: "part-group", targetId: made?.id, targetLabel: String(body.name || ""), detail: made ? made.models.join("、") : "" }), () => savePartGroup(null, body));
    return Response.json(group, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
