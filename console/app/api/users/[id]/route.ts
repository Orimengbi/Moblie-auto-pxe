import { audited, jsonError, readJson } from "@/lib/api";
import {
  assertWithin,
  AuthError,
  can,
  createSession,
  deleteUser,
  getUser,
  publicUser,
  requirePermission,
  requireSelfOrAdmin,
  rolePermissions,
  sessionCookie,
  updateUser,
  verifyLoginPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

interface UserPatch {
  role?: string;
  disabled?: boolean;
  password?: string | null;
  currentPassword?: string;
}

/** 有「用户」权限的能改所有字段（不能超出自己的权限）；其他人只能改自己的密码。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const identity = requireSelfOrAdmin(request, id);
    const body = await readJson<UserPatch>(request);
    const manager = can(identity, "users");
    if (!manager && (body.role !== undefined || body.disabled !== undefined || body.password === null)) {
      throw new AuthError("需要「用户、角色和审计」权限", 403);
    }
    const target = getUser(id);
    if (target && target.id !== identity.user.id) assertWithin(identity, rolePermissions(target.role), "这个账号");
    if (body.role !== undefined) assertWithin(identity, rolePermissions(String(body.role)), "这个角色");
    // 改自己的密码要输当前密码，会话被人捡到也改不了。
    const current = identity.user.passwordHash;
    if (identity.user.id === id && body.password && current && !verifyLoginPassword(String(body.currentPassword || ""), current)) {
      throw new Error("当前密码不对");
    }
    if (!getUser(id)) throw new Error("用户不存在");
    const changes = [body.role && `角色 ${body.role}`, body.disabled !== undefined && (body.disabled ? "停用" : "启用"), body.password && "改密码", body.password === null && "清除密码"].filter(Boolean).join("，");
    const user = await audited(request, { action: "修改用户", targetType: "user", targetId: id, targetLabel: getUser(id)?.username, detail: changes }, () =>
      updateUser(id, { role: body.role, disabled: body.disabled, password: body.password }),
    );
    // 改了自己的账号会让旧会话失效，这里换一张新的。
    const headers = new Headers();
    if (user.id === identity.user.id && !user.disabled) {
      const method = identity.method === "password" && !user.passwordHash ? null : identity.method;
      if (method) headers.set("set-cookie", sessionCookie(createSession({ user, method, credentialId: identity.credentialId })));
    }
    return Response.json(publicUser(user), { headers });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const identity = requirePermission(request, "users");
    if (identity.user.id === id) throw new Error("不能删除自己");
    const target = getUser(id);
    if (target) assertWithin(identity, rolePermissions(target.role), "这个账号");
    await audited(request, { action: "删除用户", targetType: "user", targetId: id, targetLabel: getUser(id)?.username }, () => deleteUser(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
