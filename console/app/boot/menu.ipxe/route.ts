import { menuFor } from "@/lib/boot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const mac = new URL(request.url).searchParams.get("mac");
  const body = await menuFor(mac);
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
