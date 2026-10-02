import { jsonError } from "@/lib/api";
import { normalizeMac } from "@/lib/net";
import { renderAnswer } from "@/lib/render";
import { getImage, getProfile, getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const profile = getProfile(id);
    if (!profile) return jsonError(new Error("安装配置不存在"), 404);
    const image = getImage(profile.imageId);
    if (!image) return jsonError(new Error("镜像不存在"), 404);
    const mac = normalizeMac(new URL(request.url).searchParams.get("mac") || "00:11:22:33:44:55");
    const state = getState();
    const files = renderAnswer(profile, image, mac, state.network.serverIp, null, state.network.httpPort);
    return Response.json({ files });
  } catch (error) {
    return jsonError(error);
  }
}
