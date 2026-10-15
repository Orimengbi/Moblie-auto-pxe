import { auditRequest, jsonError, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { startBackup } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = requirePermission(request, "system");
    const body = await readJson<{ full?: boolean }>(request);
    const full = Boolean(body.full);
    const job = startBackup({ full, reason: "手动", actor: identity.user.username });
    auditRequest(request, identity, { action: "开始备份", targetType: "system", targetLabel: full ? "完整备份" : "数据和配置" });
    return Response.json(job, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
