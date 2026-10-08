import { audited, jsonError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deleteFile, getFile } from "@/lib/store";

export const dynamic = "force-dynamic";

// 这个路由不经过 middleware（见 middleware.ts），自己检查登录。
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // 删除统一只有管理员能做。
    requireAdmin(request);
    const { id } = await context.params;
    await audited(request, { action: "删除任务文件", targetType: "file", targetId: id, targetLabel: getFile(id)?.name }, () => deleteFile(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
