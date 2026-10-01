import { renderIpxeMenu } from "@/lib/render";
import { diagReady, getImage, getState, listProfiles } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  const state = getState();
  const entries = listProfiles().flatMap((profile) => {
    const image = getImage(profile.imageId);
    if (!image || image.status !== "ready" || !image.kernelFile) return [];
    return [{ profile, image }];
  });
  const body = renderIpxeMenu({
    serverIp: state.network.serverIp,
    timeoutSec: state.network.menuTimeoutSec,
    entries,
    diagReady: diagReady(),
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
