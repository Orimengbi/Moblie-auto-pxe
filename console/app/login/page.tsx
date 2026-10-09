import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Activity, Building2, Rocket, Server } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { authenticate } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: Server, title: "资产台账", text: "SN、配置、客户、保修和整机硬件清单" },
  { icon: Building2, title: "机房机柜", text: "数据中心 → 机房 → 机柜 → U 位" },
  { icon: Activity, title: "监控工单", text: "BMC 传感器、GPU、交换机端口告警，一键转工单" },
  { icon: Rocket, title: "PXE 装机", text: "按批次无人值守安装或写入整盘镜像" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // 只跳回本站路径，防止 ?next=//evil.example 之类的外跳。
  const target = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  if (authenticate(await headers())) redirect(target);
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col">
        {/* 背景的机柜网格只是装饰。 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)", backgroundSize: "28px 28px" }}
        />
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Server className="size-5" />
          </span>
          <span className="text-lg font-semibold text-sidebar-accent-foreground">资产运维平台</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl leading-tight font-semibold text-sidebar-accent-foreground">服务器从入库、上架、装机到维修，一处管完。</h2>
          <ul className="mt-8 grid gap-4 text-sm">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                  <Icon className="size-4" />
                </span>
                <span>
                  <span className="block font-medium text-sidebar-accent-foreground">{title}</span>
                  <span className="block text-sidebar-foreground/70">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Server className="size-4" />
            </span>
            <span className="font-semibold">资产运维平台</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">登录</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">用密码、访问密钥或 SSH 公钥签名登录。</p>
          <LoginForm next={target} />
        </div>
      </section>
    </main>
  );
}
