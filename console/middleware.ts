import { NextResponse, type NextRequest } from "next/server";
import { authenticate, sameOrigin } from "@/lib/auth";
import { atLeast, requiredRole, roleDenied } from "@/lib/roles";

const PUBLIC = new Set(["/login", "/api/auth/login", "/api/auth/challenge", "/api/auth/logout"]);

/**
 * 除了目标机用的 /boot/ 和登录接口，控制台页面和 API 都要先登录。
 * /api/files 不经过这里：中间件会把请求体缓存一份且超过 10MB 就截断，
 * 那两个路由自己调 requireRole。
 * API 的写请求按 lib/roles.ts 的分级挡一道（只读、值班、工程师），管理员专属的路由里再查。
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
    const min = api ? requiredRole(request.method, pathname) : "viewer";
    if (!atLeast(identity.user.role, min)) return NextResponse.json({ error: roleDenied(min) }, { status: 403 });
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
  matcher: ["/((?!boot/|_next/static|_next/image|favicon\\.ico|api/files).*)"],
};
