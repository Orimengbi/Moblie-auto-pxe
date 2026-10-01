import { jsonError, readJson } from "@/lib/api";
import { createProject, listProjects, type ProjectInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listProjects());
}

export async function POST(request: Request) {
  try {
    const body = await readJson<ProjectInput>(request);
    return Response.json(await createProject(body), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
