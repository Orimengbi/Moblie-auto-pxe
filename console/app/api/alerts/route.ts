import { alertCounts, listAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/** ?asset= 只看一台的。 */
export function GET(request: Request) {
  const asset = new URL(request.url).searchParams.get("asset") || undefined;
  return Response.json({ alerts: listAlerts({ assetId: asset, resolvedLimit: asset ? 50 : 200 }), counts: alertCounts() });
}
