import fs from "node:fs";
import { Readable } from "node:stream";
import { audited, auditRequest, jsonError } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { backupPath, deleteBackup } from "@/lib/system";

export const dynamic = "force-dynamic";

/** 下载备份。里面有账号、BMC 密码和 SSH 私钥，所以和做备份要同样的权限，并记审计。 */
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    const identity = requirePermission(request, "system");
    const { name } = await context.params;
    const file = backupPath(name);
    if (!fs.existsSync(file)) return Response.json({ error: "备份不存在" }, { status: 404 });
    auditRequest(request, identity, { action: "下载备份", targetType: "system", targetLabel: name });
    const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(fs.statSync(file).size),
        "content-disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    requirePermission(request, "system");
    const { name } = await context.params;
    await audited(request, { action: "删除备份", targetType: "system", targetLabel: name }, () => deleteBackup(name));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
