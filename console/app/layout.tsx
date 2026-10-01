import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
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
  description: "移动小主机上的 Linux 无人值守安装与内存验机",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
          <aside className="border-b bg-card md:border-r md:border-b-0">
            <div className="px-5 pt-5 pb-3">
              <p className="text-xs tracking-[0.16em] text-muted-foreground">移动小主机</p>
              <p className="text-lg font-semibold">PXE 装机台</p>
            </div>
            <Nav />
          </aside>
          <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
