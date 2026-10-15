import { jsonError } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { systemOverview } from "@/lib/system";

export const dynamic = "force-dynamic";

/** 「系统」页的全部状态，页面轮询它看备份和升级的进度。 */
export function GET(request: Request) {
  try {
    requirePermission(request, "system");
    return Response.json(systemOverview());
  } catch (error) {
    return jsonError(error);
  }
}
