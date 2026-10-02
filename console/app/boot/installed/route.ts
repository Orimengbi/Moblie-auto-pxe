import { markServerInstalled } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sn = new URL(request.url).searchParams.get("sn") || "";
  await markServerInstalled(sn);
  return new Response("ok\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
