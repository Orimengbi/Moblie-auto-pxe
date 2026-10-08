/**
 * 页面上的时间统一用北京时间显示。服务端（容器是 UTC）和浏览器各渲染一遍，不指定时区两边会不一样，
 * 首屏时间错、React 还报 hydration 不一致。要换时区改 TIME_ZONE。
 */
export const TIME_ZONE = "Asia/Shanghai";

const FORMATS: Record<"full" | "short" | "date" | "time", Intl.DateTimeFormatOptions> = {
  full: { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
  short: { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false },
  date: { year: "numeric", month: "2-digit", day: "2-digit" },
  time: { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
};

export function formatTime(value: string | number | Date, style: keyof typeof FORMATS = "full"): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { ...FORMATS[style], timeZone: TIME_ZONE });
}
