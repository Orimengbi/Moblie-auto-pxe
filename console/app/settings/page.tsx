import { headers } from "next/headers";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Stack from "@mui/material/Stack";
import { PageHeader } from "@/components/page-header";
import { MonitorSettingsForm } from "@/components/monitor-settings-form";
import { SnmpProfileManager } from "@/components/snmp-profile-manager";
import { TagSettingsForm } from "@/components/tag-settings-form";
import { getTagSettings, listAssets, listCustomers } from "@/lib/assets";
import { authenticate } from "@/lib/auth";
import { getMonitorSettings } from "@/lib/monitor";
import { listSnmpProfiles, publicSnmpProfile } from "@/lib/snmp";

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
    <Stack spacing={2}>
      <PageHeader title="设置" description="全局设置，改了马上生效。" />
      <Card>
        <CardHeader title="资产编号" />
        <CardContent>
          <TagSettingsForm settings={getTagSettings()} customers={listCustomers()} samples={samples} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="监控" />
        <CardContent>
          <MonitorSettingsForm settings={getMonitorSettings()} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="SNMP 凭据" />
        <CardContent>
          <SnmpProfileManager profiles={listSnmpProfiles().map(publicSnmpProfile)} />
        </CardContent>
      </Card>
    </Stack>
  );
}
