import { audited, jsonError } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { restartConsoleSoon, stageRestore } from "@/lib/system";

export const dynamic = "force-dynamic";

/** 解好备份后让控制台重启，启动时换进去。页面等它重新连上。 */
export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    const identity = requirePermission(request, "system");
    const { name } = await context.params;
    const manifest = await audited(request, { action: "恢复备份", targetType: "system", targetLabel: name }, () => stageRestore(name, identity.user.username));
    restartConsoleSoon();
    return Response.json({ ok: true, manifest });
  } catch (error) {
    return jsonError(error);
  }
}
