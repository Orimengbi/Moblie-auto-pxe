import { audited, jsonError, readJson } from "@/lib/api";
import { assertWithin, listRoles, listUsers, requirePermission, requireUser, saveRole } from "@/lib/auth";
import { isPermission } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** 角色列表，带每个角色有几个账号在用。登录了就能看（页面上要显示角色名）。 */
export function GET(request: Request) {
  try {
    requireUser(request);
    const users = listUsers();
    return Response.json(listRoles().map((role) => ({ ...role, users: users.filter((user) => user.role === role.id).length })));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = requirePermission(request, "users");
    const body = await readJson<{ name?: string; description?: string; permissions?: unknown[] }>(request);
    assertWithin(identity, (body.permissions || []).filter(isPermission), "这个角色");
    const role = await audited(request, (r) => ({ action: "新建角色", targetType: "role", targetId: r?.id, targetLabel: String(body.name || ""), detail: (body.permissions || []).join(",") }), () => saveRole(body));
    return Response.json(role);
  } catch (error) {
    return jsonError(error);
  }
}
