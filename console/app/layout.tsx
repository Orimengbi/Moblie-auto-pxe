import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Server } from "lucide-react";
import { Nav } from "@/components/nav";
import { TaskCenter } from "@/components/task-center";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { UploadProvider } from "@/components/upload-provider";
import { alertCounts } from "@/lib/alerts";
import { authenticate } from "@/lib/auth";
import { openTicketCount } from "@/lib/tickets";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "资产运维平台",
  description: "服务器资产台账、运维和 PXE 装机",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 没登录时 middleware 只放行登录页，这时不显示侧栏。
  const identity = authenticate(await headers());
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          {identity ? (
            <UploadProvider>
              <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
                <aside className="bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen md:flex-col">
                  <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
                      <Server className="size-4" />
                    </span>
                    <span className="leading-tight">
                      <span className="block text-[15px] font-semibold text-sidebar-accent-foreground">资产运维平台</span>
                      <span className="block text-[11px] tracking-[0.14em] text-sidebar-foreground/55">资产 · 运维 · 装机</span>
                    </span>
                  </div>
                  <Nav
                    user={{ username: identity.user.username, role: identity.user.role }}
                    counts={{ alerts: alertCounts(), tickets: openTicketCount() }}
                  />
                </aside>
                <div className="min-w-0">
                  <div className="sticky top-0 z-30 flex h-12 items-center justify-end gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-8">
                    <TaskCenter />
                    <ThemeToggle />
                  </div>
                  <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-7">{children}</main>
                </div>
              </div>
            </UploadProvider>
          ) : (
            children
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
