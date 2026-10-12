import { auditRequest, jsonError } from "@/lib/api";
import { authenticate, requirePermission } from "@/lib/auth";
import { appendFirmwareUpload, discardFirmwareUpload, FirmwareUploadConflict } from "@/lib/firmware-lib";
import { FIRMWARE_KIND_LABEL } from "@/lib/firmware-types";

export const dynamic = "force-dynamic";

/** 追加一段（头 upload-offset 是这段从哪开始）。最后一段到了会解包识别，返回识别好的固件包。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requirePermission(request, "firmware");
    const { id } = await context.params;
    const offset = Number(request.headers.get("upload-offset"));
    if (!Number.isInteger(offset) || offset < 0) throw new Error("缺少上传位置");
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length) throw new Error("这一段是空的");
    const result = await appendFirmwareUpload(id, offset, bytes);
    if (result.package) {
      const pkg = result.package;
      auditRequest(request, authenticate(request.headers), {
        action: "上传固件包",
        targetType: "firmware",
        targetId: pkg.id,
        targetLabel: pkg.fileName,
        detail: `${FIRMWARE_KIND_LABEL[pkg.kind]} ${pkg.version}，适用 ${pkg.models.join("、") || "未识别"}`,
      });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof FirmwareUploadConflict) return Response.json({ error: error.message, offset: error.offset }, { status: 409 });
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requirePermission(request, "firmware");
    const { id } = await context.params;
    discardFirmwareUpload(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
