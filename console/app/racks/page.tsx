import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { RackBoard } from "@/components/rack-board";
import { assetRows } from "@/lib/asset-view";
import { listAlerts } from "@/lib/alerts";
import { listRacks, listSites } from "@/lib/racks";
import type { AlertSeverity } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function RacksPage() {
  // 每台资产最严重的未恢复告警，俯视图按告警上色用。
  const alerts: Record<string, AlertSeverity> = {};
  for (const alert of listAlerts({ resolvedLimit: 0 })) {
    if (alert.status === "resolved") continue;
    if (alert.severity === "critical" || !alerts[alert.assetId]) alerts[alert.assetId] = alert.severity;
  }
  return (
    <div>
      <PageHeader title="机房" description="机房、机柜和 U 位。正视图里机柜从下往上数，U1 在最底下，点设备打开资产，点空 U 位把一台资产放进去；俯视图看整个机房的机柜摆放，按利用率或告警上色。" />
      <Suspense>
        <RackBoard sites={listSites()} racks={listRacks()} assets={assetRows(undefined, undefined, { light: true })} alerts={alerts} />
      </Suspense>
    </div>
  );
}
