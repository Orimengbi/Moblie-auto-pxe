/**
 * 页面上的时间按「设置」里选的时区显示，默认北京时间。服务端（容器是 UTC）和浏览器各渲染一遍，
 * 不指定时区两边会不一样，首屏时间错、React 还报 hydration 不一致。
 * 时区放在 globalThis：服务端由 display-settings.ts 启动时和保存时设；浏览器由根布局的内联脚本在页面脚本之前设。
 */
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

/** 设置页下拉框里的常用时区。 */
export const TIME_ZONES: [string, string][] = [
  ["Asia/Shanghai", "北京 / 上海 UTC+8"],
  ["Asia/Hong_Kong", "香港 UTC+8"],
  ["Asia/Singapore", "新加坡 UTC+8"],
  ["Asia/Tokyo", "东京 UTC+9"],
  ["Asia/Seoul", "首尔 UTC+9"],
  ["Asia/Kolkata", "印度 UTC+5:30"],
  ["Asia/Dubai", "迪拜 UTC+4"],
  ["Europe/London", "伦敦（夏令时 UTC+1）"],
  ["Europe/Berlin", "柏林 / 法兰克福（夏令时 UTC+2）"],
  ["America/New_York", "纽约（夏令时 UTC-4）"],
  ["America/Los_Angeles", "洛杉矶（夏令时 UTC-7）"],
  ["UTC", "UTC"],
];

declare global {
  var pxeTimeZone: string | undefined;
}

export function displayTimeZone(): string {
  return globalThis.pxeTimeZone || DEFAULT_TIME_ZONE;
}

export function setDisplayTimeZone(zone: string): void {
  globalThis.pxeTimeZone = zone;
}

export function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return Boolean(zone);
  } catch {
    return false;
  }
}

const FORMATS: Record<"full" | "short" | "date" | "time", Intl.DateTimeFormatOptions> = {
  full: { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
  short: { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false },
  date: { year: "numeric", month: "2-digit", day: "2-digit" },
  time: { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false },
};

export function formatTime(value: string | number | Date, style: keyof typeof FORMATS = "full"): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { ...FORMATS[style], timeZone: displayTimeZone() });
}

/** BMC 时区下拉框：和 UTC 的差，Redfish DateTimeLocalOffset 的写法。 */
export const UTC_OFFSETS: string[] = [
  ...Array.from({ length: 12 }, (_, index) => `-${String(12 - index).padStart(2, "0")}:00`),
  "+00:00",
  "+01:00",
  "+02:00",
  "+03:00",
  "+04:00",
  "+05:00",
  "+05:30",
  "+05:45",
  "+06:00",
  "+07:00",
  "+08:00",
  "+09:00",
  "+09:30",
  "+10:00",
  "+11:00",
  "+12:00",
  "+13:00",
  "+14:00",
];
