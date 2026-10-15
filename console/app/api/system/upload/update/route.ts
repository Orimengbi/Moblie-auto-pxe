import { audited, jsonError } from "@/lib/api";
import { requirePermission } from "@/lib/auth";
import { receiveUpdateBundle } from "@/lib/system";

export const dynamic = "force-dynamic";

// 这个路由不经过 middleware（见 middleware.ts），自己检查登录。只存文件；验签和安装在宿主机上做。
export async function PUT(request: Request) {
  try {
    requirePermission(request, "system");
    const name = new URL(request.url).searchParams.get("name") || "";
    if (!request.body) throw new Error("没有收到文件内容");
    const body = request.body;
    return Response.json(await audited(request, (info) => ({ action: "上传升级包", targetType: "system", targetLabel: name, detail: info ? `版本 ${info.version}` : "" }), () => receiveUpdateBundle(name, body)));
  } catch (error) {
    return jsonError(error);
  }
}
