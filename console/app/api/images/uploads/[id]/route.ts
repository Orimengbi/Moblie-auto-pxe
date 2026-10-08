import { audited, jsonError } from "@/lib/api";
import { startExtract } from "@/lib/jobs";
import { UploadConflict, appendUpload, discardUpload, uploadStatus } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(uploadStatus(id));
  } catch (error) {
    return jsonError(error, 404);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const offset = Number(request.headers.get("upload-offset"));
    if (!Number.isInteger(offset) || offset < 0) throw new Error("缺少上传位置");
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length) throw new Error("这一段是空的");
    const result = await appendUpload(id, offset, bytes);
    if (result.image) startExtract(result.image.id);
    return Response.json({ ...result.session, image: result.image });
  } catch (error) {
    if (error instanceof UploadConflict) {
      return Response.json({ error: error.message, offset: error.offset }, { status: 409 });
    }
    return jsonError(error);
  }
}

/** 取消一个没传完的上传（删掉已经传上来的部分）。只是取消操作，不限管理员，但记审计。 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await audited(request, { action: "取消镜像上传", targetType: "image", targetId: id }, () => discardUpload(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error, 404);
  }
}
