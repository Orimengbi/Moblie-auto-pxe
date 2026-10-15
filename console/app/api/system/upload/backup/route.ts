import { audited, jsonError } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { receiveBackup } from "@/lib/system";

export const dynamic = "force-dynamic";

// 这个路由不经过 middleware（见 middleware.ts），自己检查登录。备份按流写盘，几十 GB 也不占内存。
export async function PUT(request: Request) {
  try {
    requirePermission(request, "system");
    const name = new URL(request.url).searchParams.get("name") || "";
    if (!request.body) throw new Error("没有收到文件内容");
    const body = request.body;
    return Response.json(await audited(request, (info) => ({ action: "上传备份", targetType: "system", targetLabel: info?.name || name }), () => receiveBackup(name, body)));
  } catch (error) {
    return jsonError(error);
  }
}
