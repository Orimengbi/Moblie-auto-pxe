import { audited, jsonError, readJson } from "@/lib/api";
import { getProject, setProjectEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ enabled?: boolean }>(request);
    return Response.json(await audited(request, { action: body.enabled ? "打开装机批次" : "关闭装机批次", targetType: "project", targetId: id, targetLabel: getProject(id)?.name }, () => setProjectEnabled(id, Boolean(body.enabled))));
  } catch (error) {
    return jsonError(error);
  }
}
