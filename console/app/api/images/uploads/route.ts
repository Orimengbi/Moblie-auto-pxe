import { jsonError, readJson } from "@/lib/api";
import { openUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ filename?: string; size?: number; name?: string; fingerprint?: string }>(request);
    if (!body.filename || !body.fingerprint) throw new Error("缺少文件名或上传标识");
    const session = openUpload({
      filename: body.filename,
      size: Number(body.size),
      name: body.name || "",
      fingerprint: body.fingerprint,
    });
    return Response.json(session, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
