"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  { href: "/", label: "总览" },
  { href: "/projects", label: "项目" },
  { href: "/images", label: "镜像" },
];

export function Nav({ user }: { user: { username: string; role: string } }) {
  const pathname = usePathname();
  const links = [...LINKS, ...(user.role === "admin" ? [{ href: "/users", label: "用户" }] : []), { href: "/account", label: "我的账号" }];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pb-8">
      {links.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 text-sm",
              active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
            )}
          >
            {link.label}
          </Link>
        );
      })}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm text-muted-foreground md:mt-4 md:border-t md:pt-4">
        <span className="truncate">{user.username}</span>
        <button type="button" onClick={logout} className="text-foreground underline-offset-4 hover:underline">
          退出
        </button>
      </div>
    </nav>
  );
}
