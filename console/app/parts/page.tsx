import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { PartsBoard } from "@/components/parts-board";
import { listAssets } from "@/lib/assets";
import { authenticate } from "@/lib/auth";
import { listCatalog } from "@/lib/catalog";
import { listPartGroups, partSets } from "@/lib/part-groups";
import { listParts } from "@/lib/parts";
import { listDatacenters, listSites } from "@/lib/racks";

export const dynamic = "force-dynamic";

export default async function PartsPage() {
  const identity = authenticate(await headers());
  return (
    <div>
      <PageHeader title="备件" description="备件库存和流转：入库、装机、拆下、返修、报废。同一替换组的型号算一组，按硬件采集看哪些主机用得上；租借的备件只能用在出借方指定的机器上。" />
      <PartsBoard
        parts={listParts()}
        sets={partSets()}
        groups={listPartGroups()}
        catalog={listCatalog()}
        admin={identity?.user.role === "admin"}
        sites={listSites()}
        datacenters={listDatacenters()}
        assets={listAssets().map((asset) => ({ id: asset.id, tag: asset.tag }))}
      />
    </div>
  );
}
