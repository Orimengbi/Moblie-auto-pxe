import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Nav } from "@/components/nav";
import { TaskCenter } from "@/components/task-center";
import { UploadProvider } from "@/components/upload-provider";
import { authenticate } from "@/lib/auth";
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
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {identity ? (
          <UploadProvider>
            <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
              <aside className="border-b bg-card md:border-r md:border-b-0">
                <div className="px-5 pt-5 pb-3">
                  <p className="text-xs tracking-[0.16em] text-muted-foreground">资产 · 运维 · 装机</p>
                  <p className="text-lg font-semibold">资产运维平台</p>
                </div>
                <Nav user={{ username: identity.user.username, role: identity.user.role }} />
              </aside>
              <main className="relative px-4 py-6 md:px-8 md:py-8">
                <div className="mb-4 flex justify-end xl:absolute xl:top-8 xl:right-8 xl:mb-0">
                  <TaskCenter />
                </div>
                {children}
              </main>
            </div>
          </UploadProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
