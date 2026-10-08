import { PageHeader } from "@/components/page-header";
import { PartsBoard } from "@/components/parts-board";
import { listAssets } from "@/lib/assets";
import { listParts, stockSummary } from "@/lib/parts";
import { listSites } from "@/lib/racks";

export const dynamic = "force-dynamic";

export default function PartsPage() {
  return (
    <div>
      <PageHeader title="备件" description="备件库存和流转：入库、装机、拆下、返修、报废。工单里换件时会自动更新这里；硬件采集发现库里的序列号装到了某台机器上，也会自动标成已装机。" />
      <PartsBoard
        parts={listParts()}
        summary={stockSummary()}
        sites={listSites()}
        assets={listAssets().map((asset) => ({ id: asset.id, tag: asset.tag }))}
      />
    </div>
  );
}
