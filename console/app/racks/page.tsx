import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { RackBoard } from "@/components/rack-board";
import { assetRows } from "@/lib/asset-view";
import { listRacks, listSites } from "@/lib/racks";

export const dynamic = "force-dynamic";

export default function RacksPage() {
  return (
    <div>
      <PageHeader title="机房" description="机房、机柜和 U 位。机柜从下往上数，U1 在最底下。点设备打开资产，点空 U 位把一台资产放进去；颜色按状态，在用是实心，维修中标红。" />
      <Suspense>
        <RackBoard sites={listSites()} racks={listRacks()} assets={assetRows(undefined, undefined, { light: true })} />
      </Suspense>
    </div>
  );
}
