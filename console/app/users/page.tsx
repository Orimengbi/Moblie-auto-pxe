import { headers } from "next/headers";
import Box from "@mui/material/Box";
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
    <Box sx={{ maxWidth: 896 }}>
      <PageHeader
        title="用户"
        description="按只读、值班、工程师、管理员四级分配权限；只有管理员能管理用户和别人的密钥。停用、改角色或重设密码后，这个用户的所有登录立即失效。"
      />
      <UserAdmin users={listUsers().map(publicUser)} selfId={identity.user.id} />
    </Box>
  );
}
