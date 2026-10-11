import { headers } from "next/headers";
import { CatalogBoard } from "@/components/catalog-board";
import { PageHeader } from "@/components/page-header";
import { authenticate } from "@/lib/auth";
import { listCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const identity = authenticate(await headers());
  return (
    <div>
      <PageHeader
        title="型号字典"
        description="服务器、交换机和各种配件的厂商、型号和规格，比如内存是 DDR 几、多大、多快。备件和主机页按这里显示规格。管理员维护，也可以按硬件采集自动补全（只补空着的，不覆盖人填的）。"
      />
      <CatalogBoard entries={listCatalog()} admin={identity?.user.role === "admin"} />
    </div>
  );
}
