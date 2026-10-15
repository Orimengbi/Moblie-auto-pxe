import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { SystemAdmin } from "@/components/system-admin";
import { authenticate, can } from "@/lib/auth";
import { systemOverview } from "@/lib/system";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const identity = authenticate(await headers());
  if (!can(identity, "system")) return <PageHeader title="备份和升级" description="需要「备份和升级」权限。" />;
  return (
    <div>
      <PageHeader title="备份和升级" description="控制台版本、离线升级，数据备份和恢复。" />
      <SystemAdmin initial={systemOverview()} />
    </div>
  );
}
