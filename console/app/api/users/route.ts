import { audited, jsonError, readJson } from "@/lib/api";
import { assertWithin, createUser, listUsers, publicUser, requirePermission, rolePermissions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    requirePermission(request, "users");
    return Response.json(listUsers().map(publicUser));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = requirePermission(request, "users");
    const body = await readJson<{ username?: string; role?: string; password?: string }>(request);
    assertWithin(identity, rolePermissions(body.role ?? "engineer"), "这个角色");
    return Response.json(publicUser(await audited(request, (u) => ({ action: "新建用户", targetType: "user", targetId: u?.id, targetLabel: body.username, detail: body.role }), () => createUser(body))));
  } catch (error) {
    return jsonError(error);
  }
}
