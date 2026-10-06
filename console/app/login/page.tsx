import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { authenticate } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // 只跳回本站路径，防止 ?next=//evil.example 之类的外跳。
  const target = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  if (authenticate(await headers())) redirect(target);
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="text-xs tracking-[0.16em] text-muted-foreground">移动小主机</p>
        <h1 className="mb-6 text-2xl font-semibold">PXE 装机台</h1>
        <LoginForm next={target} />
      </div>
    </main>
  );
}
