"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  Boxes,
  Building2,
  CircleUser,
  ClipboardList,
  Disc3,
  LayoutDashboard,
  LogOut,
  Rocket,
  ScrollText,
  Server,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";

export type NavCounts = { alerts: { critical: number; warning: number }; tickets: number };

type NavLink = { href: string; label: string; icon: LucideIcon; badge?: { value: number; tone: "critical" | "warning" | "info" } };

/** 分组显示：资产运维在前，装机是其中一项功能。 */
function groups(role: string, counts: NavCounts): { title: string; links: NavLink[] }[] {
  const admin = role === "admin";
  const alertTotal = counts.alerts.critical + counts.alerts.warning;
  return [
    {
      title: "资产运维",
      links: [
        { href: "/", label: "总览", icon: LayoutDashboard },
        { href: "/assets", label: "资产", icon: Server },
        { href: "/racks", label: "机房", icon: Building2 },
        { href: "/alerts", label: "告警", icon: Bell, badge: { value: alertTotal, tone: counts.alerts.critical ? "critical" : "warning" } },
        { href: "/tickets", label: "工单", icon: ClipboardList, badge: { value: counts.tickets, tone: "info" } },
        { href: "/parts", label: "备件", icon: Boxes },
        { href: "/customers", label: "客户", icon: Users },
      ],
    },
    {
      title: "装机",
      links: [
        { href: "/projects", label: "装机批次", icon: Rocket },
        { href: "/images", label: "镜像", icon: Disc3 },
      ],
    },
    {
      title: "系统",
      links: [
        ...(admin
          ? [
              { href: "/audit", label: "审计", icon: ScrollText },
              { href: "/settings", label: "设置", icon: Settings },
              { href: "/users", label: "用户", icon: UserCog },
            ]
          : []),
        { href: "/account", label: "我的账号", icon: CircleUser },
      ],
    },
  ];
}

const BADGE_TONE = {
  critical: "bg-destructive text-white",
  warning: "bg-warning text-black/80",
  info: "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-border",
};

export function Nav({ user, counts: initial }: { user: { username: string; role: string }; counts: NavCounts }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState(initial);

  // 布局在页面切换时不会重新渲染，角标自己去拉；切页面时和每分钟各拉一次。
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/nav-counts")
        .then((response) => (response.ok ? response.json() : null))
        .then((next: NavCounts | null) => {
          if (next && !stop) setCounts(next);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:min-h-0 md:flex-1 md:flex-col md:gap-0 md:overflow-y-auto">
      {groups(user.role, counts).map((group) => (
        <div key={group.title} className="contents md:mt-5 md:flex md:flex-col md:gap-0.5 md:first:mt-1">
          <span className="hidden px-3 pb-1.5 text-[11px] font-medium tracking-[0.12em] text-sidebar-foreground/50 md:block">{group.title}</span>
          {group.links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-70 group-hover:opacity-100")} />
                <span className="flex-1">{link.label}</span>
                {link.badge && link.badge.value > 0 ? (
                  <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums", BADGE_TONE[link.badge.tone])}>
                    {link.badge.value > 99 ? "99+" : link.badge.value}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="flex shrink-0 items-center gap-2.5 px-3 py-2 text-sm md:mt-auto md:border-t md:border-sidebar-border md:px-2 md:pt-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground uppercase">
          {user.username.slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sidebar-accent-foreground">{user.username}</span>
          <span className="block text-xs text-sidebar-foreground/60">{user.role === "admin" ? "管理员" : "普通用户"}</span>
        </span>
        <button
          type="button"
          onClick={logout}
          title="退出登录"
          className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="size-4" />
          <span className="sr-only">退出</span>
        </button>
      </div>
    </nav>
  );
}
