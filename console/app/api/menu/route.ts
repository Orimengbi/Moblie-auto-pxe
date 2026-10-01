import { renderIpxeMenu } from "@/lib/render";
import { activeProject, diagReady, getImage, getState, profilesForProject } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  const state = getState();
  const active = activeProject();
  const entries = (active ? profilesForProject(active.id) : []).flatMap((profile) => {
    const image = getImage(profile.imageId);
    if (!image || image.status !== "ready" || !image.kernelFile) return [];
    return [{ profile, image }];
  });
  const body = renderIpxeMenu({
    serverIp: state.network.serverIp,
    httpPort: state.network.httpPort,
    timeoutSec: state.network.menuTimeoutSec,
    entries,
    diagReady: diagReady(),
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
