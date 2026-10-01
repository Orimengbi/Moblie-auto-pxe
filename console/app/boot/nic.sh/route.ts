import { renderNicScript } from "@/lib/render";
import { getNicBySn } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("sn") || "";
  let plan = null;
  try {
    plan = raw ? getNicBySn(raw) : null;
  } catch {
    plan = null;
  }
  return new Response(renderNicScript(plan), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
