import { headers } from "next/headers";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { CredentialManager } from "@/components/credential-manager";
import { PageHeader } from "@/components/page-header";
import { PasswordForm } from "@/components/password-form";
import { authenticate, getRole, listRoles, publicUser, rolePermissions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const identity = authenticate(await headers());
  if (!identity) return null;
  const user = publicUser(identity.user);
  const role = getRole(user.role);
  // 访问密钥能限成的角色：权限都在账号以内的那些。
  const own = new Set(rolePermissions(user.role));
  const limits = listRoles()
    .filter((item) => item.id !== user.role && item.permissions.every((permission) => own.has(permission)))
    .map((item) => ({ id: item.id, name: item.name }));
  const names = Object.fromEntries(listRoles().map((item) => [item.id, item.name]));
  return (
    <Stack spacing={4} sx={{ maxWidth: 768 }}>
      <PageHeader
        title="我的账号"
        description={`${user.username} · ${role?.name || "已删除的角色"}${role?.description ? `（${role.description}）` : ""}。可以用密码、访问密钥或 SSH 公钥签名登录，访问密钥可以限成更低的权限。`}
      />
      <Stack component="section" spacing={1.5}>
        <Typography variant="h3" component="h2">
          {user.hasPassword ? "修改密码" : "设置密码"}
        </Typography>
        <PasswordForm userId={user.id} askCurrent={user.hasPassword} />
      </Stack>
      <CredentialManager user={user} limits={limits} roleNames={names} />
    </Stack>
  );
}
