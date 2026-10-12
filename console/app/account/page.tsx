import { headers } from "next/headers";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { CredentialManager } from "@/components/credential-manager";
import { PageHeader } from "@/components/page-header";
import { PasswordForm } from "@/components/password-form";
import { authenticate, publicUser } from "@/lib/auth";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const identity = authenticate(await headers());
  if (!identity) return null;
  const user = publicUser(identity.user);
  return (
    <Stack spacing={4} sx={{ maxWidth: 768 }}>
      <PageHeader
        title="我的账号"
        description={`${user.username} · ${ROLE_LABEL[user.role]}（${ROLE_HINT[user.role]}）。可以用密码、访问密钥或 SSH 公钥签名登录，访问密钥可以限成更低的权限。`}
      />
      <Stack component="section" spacing={1.5}>
        <Typography variant="h3" component="h2">
          {user.hasPassword ? "修改密码" : "设置密码"}
        </Typography>
        <PasswordForm userId={user.id} askCurrent={user.hasPassword} />
      </Stack>
      <CredentialManager user={user} />
    </Stack>
  );
}
