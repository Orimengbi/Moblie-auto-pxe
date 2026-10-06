import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Nav } from "@/components/nav";
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
  title: "PXE 装机台",
  description: "移动小主机上的 Linux 无人值守安装",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 没登录时 middleware 只放行登录页，这时不显示侧栏。
  const identity = authenticate(await headers());
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {identity ? (
          <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
            <aside className="border-b bg-card md:border-r md:border-b-0">
              <div className="px-5 pt-5 pb-3">
                <p className="text-xs tracking-[0.16em] text-muted-foreground">移动小主机</p>
                <p className="text-lg font-semibold">PXE 装机台</p>
              </div>
              <Nav user={{ username: identity.user.username, role: identity.user.role }} />
            </aside>
            <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
