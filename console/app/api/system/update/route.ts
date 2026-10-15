import { audited, jsonError, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { requestUpdate } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = requirePermission(request, "system");
    const { file = "" } = await readJson<{ file?: string }>(request);
    return Response.json(await audited(request, { action: "开始升级", targetType: "system", targetLabel: file }, () => requestUpdate(file, identity.user.username)), { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
