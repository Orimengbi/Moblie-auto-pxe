import { audited, jsonError } from "@/lib/api";
import { getProject, reconcileServers } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const force = new URL(request.url).searchParams.get("force") === "1";
    // 页面每 30 秒自动检查一次，不记审计；手动「立即检查」会连密码不对的也重新登录 BMC，要记。
    if (!force) return Response.json(await reconcileServers(id, { force }));
    return Response.json(await audited(request, { action: "立即检查 IPMI", targetType: "project", targetId: id, targetLabel: getProject(id)?.name }, () => reconcileServers(id, { force })));
  } catch (error) {
    return jsonError(error);
  }
}
