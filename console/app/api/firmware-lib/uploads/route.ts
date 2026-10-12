import { jsonError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { openFirmwareUpload } from "@/lib/firmware-lib";

export const dynamic = "force-dynamic";

/** 开始传一个固件包，之后按段 PATCH 到 /api/firmware-lib/uploads/<id>。 */
export async function POST(request: Request) {
  try {
    const identity = requireAdmin(request);
    const body = await readJson<{ filename?: string; size?: number }>(request);
    return Response.json(openFirmwareUpload(body, identity.user.username), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
