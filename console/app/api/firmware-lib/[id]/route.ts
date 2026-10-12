import { audited, jsonError, readJson } from "@/lib/api";
import { requirePermission, requireUser } from "@/lib/auth";
import { deletePackage, getPackage, updatePackage, type FirmwarePackageInput } from "@/lib/firmware-lib";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireUser(request);
    const { id } = await context.params;
    const pkg = getPackage(id);
    if (!pkg) return Response.json({ error: "固件包不存在" }, { status: 404 });
    return Response.json(pkg);
  } catch (error) {
    return jsonError(error);
  }
}

/** 改厂商、类型、版本、适用型号、备注。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requirePermission(request, "firmware");
    const { id } = await context.params;
    const body = await readJson<FirmwarePackageInput>(request);
    return Response.json(
      await audited(request, (pkg) => ({ action: "修改固件包", targetType: "firmware", targetId: id, targetLabel: pkg?.fileName, detail: JSON.stringify(body).slice(0, 500) }), () => updatePackage(id, body)),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requirePermission(request, "firmware");
    const { id } = await context.params;
    await audited(request, (pkg) => ({ action: "删除固件包", targetType: "firmware", targetId: id, targetLabel: pkg?.fileName }), () => deletePackage(id));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
