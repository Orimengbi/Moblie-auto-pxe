import { NextResponse, type NextRequest } from "next/server";
import { authenticate, can, sameOrigin } from "@/lib/auth";
import { permissionDenied, requiredPermission } from "@/lib/roles";

const PUBLIC = new Set(["/login", "/api/auth/login", "/api/auth/challenge", "/api/auth/logout", "/api/health"]);

/**
 * 除了目标机用的 /boot/ 和登录接口，控制台页面和 API 都要先登录。
 * /api/files 和 /api/system/upload/ 不经过这里：中间件会把请求体缓存一份且超过 10MB 就截断，
 * 这些路由自己调 requirePermission。
 * API 的写请求按 lib/roles.ts 里路径对应的权限点挡一道，路由里再查一遍。
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();

  const api = pathname.startsWith("/api/");
  if (api && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request.headers)) {
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  }
  const identity = authenticate(request.headers);
  if (identity) {
    const permission = api ? requiredPermission(request.method, pathname) : null;
    if (permission && !can(identity, permission)) return NextResponse.json({ error: permissionDenied(permission) }, { status: 403 });
    return NextResponse.next();
  }

  if (api) return NextResponse.json({ error: "需要登录" }, { status: 401 });
  // 按浏览器发来的 Host 拼地址：request.url 是控制台自己监听的 127.0.0.1:3000。
  const login = new URL("/login", `${request.nextUrl.protocol}//${request.headers.get("host") || request.nextUrl.host}`);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!boot/|_next/static|_next/image|favicon\\.ico|api/files|api/system/upload/).*)"],
};
