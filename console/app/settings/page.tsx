import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { TagSettingsForm } from "@/components/tag-settings-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTagSettings, listAssets, listCustomers } from "@/lib/assets";
import { authenticate } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const identity = authenticate(await headers());
  if (identity?.user.role !== "admin") {
    return <PageHeader title="设置" description="只有管理员能改设置。" />;
  }
  const samples = listAssets()
    .slice(-8)
    .map(({ id, seq, type, sn, customerId, createdAt, tagOverride, tag }) => ({ id, seq, type, sn, customerId, createdAt, tagOverride, tag }));
  return (
    <div className="grid gap-4">
      <PageHeader title="设置" description="全局设置，改了马上生效。" />
      <Card>
        <CardHeader>
          <CardTitle>资产编号</CardTitle>
        </CardHeader>
        <CardContent>
          <TagSettingsForm settings={getTagSettings()} customers={listCustomers()} samples={samples} />
        </CardContent>
      </Card>
    </div>
  );
}
