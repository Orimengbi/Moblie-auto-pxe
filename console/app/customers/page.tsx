import { CustomerManager } from "@/components/customer-manager";
import { PageHeader } from "@/components/page-header";
import { listAssets, listCustomers } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default function CustomersPage() {
  const counts: Record<string, number> = {};
  for (const asset of listAssets()) if (asset.customerId) counts[asset.customerId] = (counts[asset.customerId] || 0) + 1;
  return (
    <div>
      <PageHeader title="客户" description="资产归属哪个客户。没有归属的资产算自有。" />
      <CustomerManager customers={listCustomers()} counts={counts} />
    </div>
  );
}
