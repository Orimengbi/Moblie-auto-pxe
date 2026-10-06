import { jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deleteFile } from "@/lib/store";

export const dynamic = "force-dynamic";

// 这个路由不经过 middleware（见 middleware.ts），自己检查登录。
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireUser(request);
    const { id } = await context.params;
    await deleteFile(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
