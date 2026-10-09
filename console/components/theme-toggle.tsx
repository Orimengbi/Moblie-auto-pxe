"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "cn";

const OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

/** 浅色 / 深色 / 跟随系统，存在浏览器里。 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // 服务端不知道浏览器选了什么，挂载后再高亮，避免水合不一致。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div role="radiogroup" aria-label="界面主题" className="flex items-center rounded-lg border bg-card p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setTheme(value)}
            className={cn("flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground", active && "bg-muted text-foreground")}
          >
            <Icon className="size-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
