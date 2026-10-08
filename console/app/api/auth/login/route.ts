import { auditRequest, jsonError, readJson } from "@/lib/api";
import {
  AuthError,
  clearLoginFailures,
  clientAddress,
  createSession,
  loginBlocked,
  loginWithPassword,
  loginWithSsh,
  publicUser,
  recordLoginFailure,
  sameOrigin,
  sessionCookie,
  verifyAccessKey,
  type Identity,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

interface LoginBody {
  method?: "password" | "key" | "ssh";
  username?: string;
  password?: string;
  key?: string;
  challenge?: string;
  signature?: string;
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request.headers)) throw new AuthError("跨站请求被拒绝", 403);
    const body = await readJson<LoginBody>(request);
    const address = clientAddress(request.headers);
    const username = String(body.username || "").trim().toLowerCase();
    if (loginBlocked(address, username)) throw new AuthError("失败次数太多，请 15 分钟后再试", 429);

    let identity: Identity | null = null;
    if (body.method === "password") identity = loginWithPassword(username, String(body.password || ""));
    else if (body.method === "key") identity = verifyAccessKey(String(body.key || ""));
    else if (body.method === "ssh") identity = loginWithSsh(String(body.challenge || ""), String(body.signature || ""));
    else throw new Error("不支持的登录方式");

    if (!identity) {
      recordLoginFailure(address, username);
      auditRequest(request, null, { action: "登录失败", targetType: "user", targetLabel: username || body.method, detail: body.method, ok: false });
      const message = { password: "用户名或密码不对", key: "访问密钥无效", ssh: "签名校验失败或挑战码已过期" }[body.method];
      throw new AuthError(message, 401);
    }
    clearLoginFailures(address);
    auditRequest(request, identity, { action: "登录", targetType: "user", targetId: identity.user.id, targetLabel: identity.user.username, detail: body.method });
    return Response.json(publicUser(identity.user), { headers: { "set-cookie": sessionCookie(createSession(identity)) } });
  } catch (error) {
    return jsonError(error);
  }
}
