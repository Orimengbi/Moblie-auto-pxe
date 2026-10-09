import { Suspense } from "react";
import { AssetList } from "@/components/asset-list";
import { PageHeader } from "@/components/page-header";
import { assetRows } from "@/lib/asset-view";
import { listCustomers } from "@/lib/assets";
import { listDatacenters, listSites } from "@/lib/racks";
import { listAllTasks, listFiles } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function AssetsPage() {
  return (
    <div>
      <PageHeader
        title="资产"
        description="所有设备的台账：编号、归属、状态、BMC、采购和保修。点一行看硬件配置、接口、拓扑和操作记录。装机批次里上传的机器会自动入库，BMC 和系统地址也会同步过来。"
      />
      <Suspense>
        <AssetList
          rows={assetRows()}
          customers={listCustomers()}
          sites={listSites()}
          datacenters={listDatacenters()}
          files={listFiles()}
          tasks={listAllTasks()
            .filter((task) => !task.projectId)
            .slice(0, 30)}
          bmcPort={process.env.PXE_BMC_PORT || ""}
        />
      </Suspense>
    </div>
  );
}
