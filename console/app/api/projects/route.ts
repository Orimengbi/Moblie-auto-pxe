import { audited, jsonError, readJson } from "@/lib/api";
import { createProject, listProjects, type ProjectInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listProjects());
}

export async function POST(request: Request) {
  try {
    const body = await readJson<ProjectInput>(request);
    return Response.json(await audited(request, (p) => ({ action: "新建装机批次", targetType: "project", targetId: p?.id, targetLabel: body.name }), () => createProject(body)), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
