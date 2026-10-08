import { audited, jsonError } from "@/lib/api";
import { deleteImage, getImage } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const image = getImage(id);
  if (!image) return jsonError(new Error("镜像不存在"), 404);
  return Response.json(image);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const image = getImage(id);
    await audited(request, { action: "删除镜像", targetType: "image", targetId: id, targetLabel: image?.name || image?.filename }, () => deleteImage(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
