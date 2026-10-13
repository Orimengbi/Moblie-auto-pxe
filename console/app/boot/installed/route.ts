import { clientIp, reportInstalled } from "@/lib/boot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return reportInstalled(new URL(request.url).searchParams.get("sn") || "", clientIp(request));
}
