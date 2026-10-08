import { audited, jsonError, readJson } from "@/lib/api";
import { createUser, listUsers, publicUser, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    requireAdmin(request);
    return Response.json(listUsers().map(publicUser));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson<{ username?: string; role?: string; password?: string }>(request);
    return Response.json(publicUser(await audited(request, (u) => ({ action: "新建用户", targetType: "user", targetId: u?.id, targetLabel: body.username, detail: body.role }), () => createUser(body))));
  } catch (error) {
    return jsonError(error);
  }
}
