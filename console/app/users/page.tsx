import { headers } from "next/headers";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { PageHeader } from "@/components/page-header";
import { RoleAdmin } from "@/components/role-admin";
import { UserAdmin } from "@/components/user-admin";
import { authenticate, can, listRoles, listUsers, publicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const identity = authenticate(await headers());
  if (!identity || !can(identity, "users")) {
    return <PageHeader title="用户" description="需要「用户、角色和审计」权限。" />;
  }
  const roles = listRoles();
  const users = listUsers();
  const own = new Set(identity.permissions);
  // 只能分配权限都在自己以内的角色。
  const allowed = roles.filter((role) => role.permissions.every((permission) => own.has(permission))).map((role) => role.id);
  const counts = Object.fromEntries(roles.map((role) => [role.id, users.filter((user) => user.role === role.id).length]));
  return (
    <Box sx={{ maxWidth: 896 }}>
      <PageHeader
        title="用户"
        description="每个账号分一个角色，角色是一组权限点，可以自己建、改。停用、改角色或重设密码后，这个用户的所有登录立即失效；改角色的权限点马上对用这个角色的人生效。"
      />
      <Stack spacing={5}>
        <UserAdmin users={users.map(publicUser)} selfId={identity.user.id} roles={roles} allowed={allowed} />
        <Stack component="section" spacing={1.5}>
          <Typography variant="h3" component="h2">
            角色
          </Typography>
          <RoleAdmin roles={roles} own={identity.permissions} counts={counts} />
        </Stack>
      </Stack>
    </Box>
  );
}
