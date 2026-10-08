"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

type NavLink = { href: string; label: string };

/** 分组显示：资产运维在前，装机是其中一项功能。 */
function groups(role: string): { title: string; links: NavLink[] }[] {
  const admin = role === "admin";
  return [
    {
      title: "",
      links: [
        { href: "/", label: "总览" },
        { href: "/assets", label: "资产" },
        { href: "/racks", label: "机房" },
        { href: "/tickets", label: "工单" },
        { href: "/parts", label: "备件" },
        { href: "/customers", label: "客户" },
      ],
    },
    {
      title: "装机",
      links: [
        { href: "/projects", label: "装机批次" },
        { href: "/images", label: "镜像" },
      ],
    },
    {
      title: "系统",
      links: [
        ...(admin
          ? [
              { href: "/audit", label: "审计" },
              { href: "/settings", label: "设置" },
              { href: "/users", label: "用户" },
            ]
          : []),
        { href: "/account", label: "我的账号" },
      ],
    },
  ];
}

export function Nav({ user }: { user: { username: string; role: string } }) {
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pb-8">
      {groups(user.role).map((group) => (
        <div key={group.title || "main"} className="contents md:mt-3 md:flex md:flex-col md:gap-1 md:first:mt-0">
          {group.title ? <span className="hidden px-3 pt-1 text-xs tracking-wide text-muted-foreground md:block">{group.title}</span> : null}
          {group.links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn("shrink-0 rounded-lg px-3 py-2 text-sm", active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm text-muted-foreground md:mt-4 md:border-t md:pt-4">
        <span className="truncate">{user.username}</span>
        <button type="button" onClick={logout} className="text-foreground underline-offset-4 hover:underline">
          退出
        </button>
      </div>
    </nav>
  );
}
