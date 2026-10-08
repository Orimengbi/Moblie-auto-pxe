import { audited, jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listFiles, saveFile } from "@/lib/store";

export const dynamic = "force-dynamic";

// 这个路由不经过 middleware（见 middleware.ts），自己检查登录。
export function GET(request: Request) {
  try {
    requireUser(request);
    return Response.json(listFiles());
  } catch (error) {
    return jsonError(error);
  }
}

/** 文件内容直接放在请求体里，按流写盘，驱动包几百 MB 也不占内存。 */
export async function PUT(request: Request) {
  try {
    requireUser(request);
    const name = new URL(request.url).searchParams.get("name") || "";
    if (!request.body) throw new Error("没有收到文件内容");
    const body = request.body;
    return Response.json(await audited(request, (f) => ({ action: "上传任务文件", targetType: "file", targetId: f?.id, targetLabel: name, detail: f ? `${f.size} 字节` : "" }), () => saveFile(name, body)));
  } catch (error) {
    return jsonError(error);
  }
}
