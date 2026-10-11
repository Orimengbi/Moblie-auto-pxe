import { getSetting, putSetting } from "./db.ts";
import { DEFAULT_TIME_ZONE, setDisplayTimeZone, validTimeZone } from "./time.ts";

/** 控制台的显示设置。现在只有时区：页面上的时间按哪个时区显示。 */
export interface DisplaySettings {
  timeZone: string;
}

export function getDisplaySettings(): DisplaySettings {
  const saved = getSetting<Partial<DisplaySettings>>("display") || {};
  return { timeZone: saved.timeZone && validTimeZone(saved.timeZone) ? saved.timeZone : DEFAULT_TIME_ZONE };
}

/** 读设置里的时区给服务端渲染用。启动时和每次渲染根布局时调用。 */
export function applyDisplaySettings(): DisplaySettings {
  const settings = getDisplaySettings();
  setDisplayTimeZone(settings.timeZone);
  return settings;
}

export function saveDisplaySettings(input: Partial<DisplaySettings>): DisplaySettings {
  const timeZone = String(input.timeZone || "").trim();
  if (!validTimeZone(timeZone)) throw new Error(`认不出时区「${timeZone}」，要写成 Asia/Shanghai 这样的 IANA 名字`);
  putSetting("display", { timeZone });
  return applyDisplaySettings();
}
