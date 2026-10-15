import { db } from "@/lib/db";
import { busyReason, consoleVersion } from "@/lib/system";

export const dynamic = "force-dynamic";

/**
 * 不用登录：升级脚本靠它确认新版本起来了、数据库打得开。
 * 经 nginx 来的请求（带 X-Real-IP）只给版本号；宿主机上的 pxectl 直连 127.0.0.1:3000（不带这个头），
 * 再告诉它有没有任务、镜像解包在跑，升级前要等它们结束。
 */
export function GET(request: Request) {
  try {
    db().prepare("SELECT 1").get();
    const local = !request.headers.get("x-real-ip");
    return Response.json({ ok: true, version: consoleVersion(), ...(local ? { busy: busyReason() } : {}) });
  } catch {
    return Response.json({ ok: false, version: consoleVersion() }, { status: 503 });
  }
}
