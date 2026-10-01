import { jsonError } from "@/lib/api";
import { startExtract } from "@/lib/jobs";
import { createImageFromIncoming, listImages, saveUploadedIso } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listImages());
}

export async function POST(request: Request) {
  try {
    const type = request.headers.get("content-type") || "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const name = String(form.get("name") || "");
      if (!(file instanceof File)) throw new Error("没有收到 ISO 文件");
      if (file.size > 256 * 1024 * 1024) {
        throw new Error("大于 256MB 的 ISO 请先放到 data/incoming，再从列表导入");
      }
      const record = await saveUploadedIso(file.name, Buffer.from(await file.arrayBuffer()), name);
      startExtract(record.id);
      return Response.json(record, { status: 201 });
    }
    const body = (await request.json()) as { filename?: string; name?: string };
    if (!body.filename) throw new Error("请指定 incoming 里的 ISO 文件名");
    const record = await createImageFromIncoming({ filename: body.filename, name: body.name || "" });
    startExtract(record.id);
    return Response.json(record, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
