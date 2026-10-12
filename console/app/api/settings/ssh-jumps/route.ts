import { audited, jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { forgetJumpChecks } from "@/lib/remote";
import { listJumpHosts, saveJumpHosts } from "@/lib/ssh-jump";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    requireAdmin(request);
    return Response.json(listJumpHosts());
  } catch (error) {
    return jsonError(error);
  }
}

/** 整个列表一起存，顺序就是匹配顺序。 */
export async function PUT(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson<unknown>(request);
    return Response.json(
      await audited(request, { action: "修改 SSH 跳板机", targetType: "settings", targetLabel: "SSH 跳板机", detail: JSON.stringify(body).slice(0, 500) }, () => {
        const saved = saveJumpHosts(body);
        forgetJumpChecks();
        return saved;
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
