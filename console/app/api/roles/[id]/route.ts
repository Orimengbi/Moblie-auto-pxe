import { audited, jsonError, readJson } from "@/lib/api";
import { assertWithin, deleteRole, getRole, requirePermission, resetRole, rolePermissions, saveRole } from "@/lib/auth";
import { BUILTIN_ROLES, isPermission } from "@/lib/roles";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** 改名字、说明、权限点；带 reset 时内置角色恢复出厂权限点。 */
export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = requirePermission(request, "users");
    const body = await readJson<{ name?: string; description?: string; permissions?: unknown[]; reset?: boolean }>(request);
    const current = getRole(id);
    if (!current) throw new Error("角色不存在");
    // 改之前和改之后都得在自己权限以内：不能动比自己大的角色，也不能加自己没有的权限点。
    assertWithin(identity, rolePermissions(id), "这个角色");
    if (body.reset) {
      assertWithin(identity, BUILTIN_ROLES.find((role) => role.id === id)?.permissions || [], "默认的权限点");
      return Response.json(await audited(request, { action: "角色恢复默认", targetType: "role", targetId: id, targetLabel: current.name, detail: "" }, () => resetRole(id)));
    }
    if (body.permissions) assertWithin(identity, body.permissions.filter(isPermission), "这个角色");
    const role = await audited(request, { action: "修改角色", targetType: "role", targetId: id, targetLabel: current.name, detail: body.permissions ? body.permissions.join(",") : String(body.name || "") }, () => saveRole({ ...body, id }));
    return Response.json(role);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    requirePermission(request, "users");
    const current = getRole(id);
    await audited(request, { action: "删除角色", targetType: "role", targetId: id, targetLabel: current?.name || id, detail: "" }, () => deleteRole(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
