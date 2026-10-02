import { renderNicScript } from "@/lib/render";
import { listNicsBySn } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("sn") || "";
  let plans: ReturnType<typeof listNicsBySn> = [];
  try {
    plans = raw ? listNicsBySn(raw) : [];
  } catch {
    plans = [];
  }
  return new Response(renderNicScript(plans), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
