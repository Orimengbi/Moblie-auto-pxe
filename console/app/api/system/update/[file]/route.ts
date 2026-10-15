import { audited, jsonError } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { deleteUpdateBundle } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ file: string }> }) {
  try {
    requirePermission(request, "system");
    const { file } = await context.params;
    await audited(request, { action: "删除升级包", targetType: "system", targetLabel: file }, () => deleteUpdateBundle(file));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
