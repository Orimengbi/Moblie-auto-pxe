import { renderIpmiScript } from "@/lib/render";
import { getIpmiBySn } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("sn") || "";
  let setting = null;
  try {
    setting = raw ? getIpmiBySn(raw) : null;
  } catch {
    setting = null;
  }
  return new Response(renderIpmiScript(setting), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
