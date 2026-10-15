import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { AppShell } from "@/components/mui/app-shell";
import { Providers } from "@/components/mui/providers";
import { UploadProvider } from "@/components/upload-provider";
import { alertCounts } from "@/lib/alerts";
import { authenticate, roleName } from "@/lib/auth";
import { applyDisplaySettings } from "@/lib/display-settings";
import { openTicketCount } from "@/lib/tickets";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Union",
  description: "服务器资产台账、运维和 PXE 装机",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 没登录时 middleware 只放行登录页，这时不显示侧栏。
  const identity = authenticate(await headers());
  // 服务端按设置里的时区渲染；浏览器在页面脚本之前由下面的内联脚本设成同一个，两边时间一致。
  const { timeZone } = applyDisplaySettings();
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="light" />
        <script dangerouslySetInnerHTML={{ __html: `globalThis.pxeTimeZone=${JSON.stringify(timeZone).replace(/</g, "\\u003c")};` }} />
        <Providers>
          {identity ? (
            <UploadProvider>
              <AppShell user={{ username: identity.user.username, roleName: roleName(identity.user.role), permissions: identity.permissions, limited: Boolean(identity.limited) }} counts={{ alerts: alertCounts(), tickets: openTicketCount() }}>
                {children}
              </AppShell>
            </UploadProvider>
          ) : (
            children
          )}
        </Providers>
      </body>
    </html>
  );
}
