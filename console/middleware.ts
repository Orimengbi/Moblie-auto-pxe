import { NextResponse, type NextRequest } from "next/server";
import { authenticate, sameOrigin } from "@/lib/auth";

const PUBLIC = new Set(["/login", "/api/auth/login", "/api/auth/challenge", "/api/auth/logout"]);

/**
 * 除了目标机用的 /boot/ 和登录接口，控制台页面和 API 都要先登录。
 * /api/files 不经过这里：中间件会把请求体缓存一份且超过 10MB 就截断，
 * 那两个路由自己调 requireUser。
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();

  const api = pathname.startsWith("/api/");
  if (api && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request.headers)) {
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  }
  if (authenticate(request.headers)) return NextResponse.next();

  if (api) return NextResponse.json({ error: "需要登录" }, { status: 401 });
  // 用相对地址跳转：经 nginx 转发时 request.url 里的端口不可靠。
  const next = pathname === "/" ? "" : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return new NextResponse(null, { status: 307, headers: { location: `/login${next}` } });
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!boot/|_next/static|_next/image|favicon\\.ico|api/files).*)"],
};
