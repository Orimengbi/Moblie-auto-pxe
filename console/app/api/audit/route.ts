import { jsonError } from "@/lib/api";
import { listAudit } from "@/lib/assets";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 操作审计，新的在前。?q= 关键字，?actor= 用户，?target= 对象 id，?before= 翻页。只有管理员能看。 */
export function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    return Response.json(
      listAudit({
        q: url.searchParams.get("q") || undefined,
        actor: url.searchParams.get("actor") || undefined,
        targetId: url.searchParams.get("target") || undefined,
        before: Number(url.searchParams.get("before")) || undefined,
        limit: Number(url.searchParams.get("limit")) || 100,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
