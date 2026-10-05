import { jsonError } from "@/lib/api";
import { listFiles, saveFile } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listFiles());
}

/** 文件内容直接放在请求体里，按流写盘，驱动包几百 MB 也不占内存。 */
export async function PUT(request: Request) {
  try {
    const name = new URL(request.url).searchParams.get("name") || "";
    if (!request.body) throw new Error("没有收到文件内容");
    return Response.json(await saveFile(name, request.body));
  } catch (error) {
    return jsonError(error);
  }
}
