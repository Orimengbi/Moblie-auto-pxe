import { headers } from "next/headers";
import { AuditLog } from "@/components/audit-log";
import { PageHeader } from "@/components/page-header";
import { authenticate, can } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const identity = authenticate(await headers());
  if (!can(identity, "users")) return <PageHeader title="审计" description="需要「用户、角色和审计」权限。" />;
  return (
    <div>
      <PageHeader title="审计" description="谁在什么时间、从哪个地址做了什么：登录、资产和装机批次的改动、电源、远程控制台、批量任务。只增不改。" />
      <AuditLog />
    </div>
  );
}
