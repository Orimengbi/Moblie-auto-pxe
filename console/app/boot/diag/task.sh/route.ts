import { diagTask, rememberMac } from "@/lib/boot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const mac = new URL(request.url).searchParams.get("mac");
  await rememberMac(mac);
  return new Response(diagTask(mac), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
