import { menuFor, serialProbe } from "@/lib/boot";
import { getState, installServerIp } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mac = url.searchParams.get("mac");
  if (!url.searchParams.has("sn")) {
    const state = getState();
    return new Response(serialProbe(installServerIp(state.network), state.network.httpPort), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const body = await menuFor(mac, url.searchParams.get("sn"));
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
