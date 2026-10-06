import { headers } from "next/headers";
import { CredentialManager } from "@/components/credential-manager";
import { PageHeader } from "@/components/page-header";
import { PasswordForm } from "@/components/password-form";
import { authenticate, publicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const identity = authenticate(await headers());
  if (!identity) return null;
  const user = publicUser(identity.user);
  return (
    <div className="grid max-w-3xl gap-8">
      <PageHeader
        title="我的账号"
        description={`${user.username} · ${user.role === "admin" ? "管理员" : "普通用户"}。可以用密码、访问密钥或 SSH 公钥签名登录，三种方式权限相同。`}
      />
      <section className="grid gap-3">
        <h2 className="text-lg font-medium">{user.hasPassword ? "修改密码" : "设置密码"}</h2>
        <PasswordForm userId={user.id} askCurrent={user.hasPassword} />
      </section>
      <CredentialManager user={user} />
    </div>
  );
}
