import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { UserAdmin } from "@/components/user-admin";
import { authenticate, listUsers, publicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const identity = authenticate(await headers());
  if (identity?.user.role !== "admin") {
    return <PageHeader title="用户" description="只有管理员能管理用户。" />;
  }
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="用户"
        description="管理员能管理用户和所有人的密钥；普通用户能使用装机、项目和批量任务，但不能管理别人的账号。停用、改角色或重设密码后，这个用户的所有登录立即失效。"
      />
      <UserAdmin users={listUsers().map(publicUser)} selfId={identity.user.id} />
    </div>
  );
}
