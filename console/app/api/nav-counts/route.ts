import { alertCounts } from "@/lib/alerts";
import { openTicketCount } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** 侧栏角标：没处理的告警和工单数。 */
export function GET() {
  return Response.json({ alerts: alertCounts(), tickets: openTicketCount() });
}
