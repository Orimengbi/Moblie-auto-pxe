/** 后端各处共用的输入校验和清洗。 */

/** 去掉回车和空字符、首尾空白，截到 max 个字符。 */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\r\0]/g, "").trim().slice(0, max);
}

/** YYYY-MM-DD，而且是真实存在的日期（不收 2026-13-45、2026-02-30）。空字符串放行。 */
export function assertDate(value: string, label: string): string {
  if (!value) return "";
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = parsed ? new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== value) throw new Error(`${label}要写成 2026-10-08 这样的日期`);
  return value;
}

/** 值必须是 labels 里的一个键。 */
export function pickEnum<T extends string>(labels: Record<T, string>, value: unknown, label: string): T {
  if (!Object.hasOwn(labels, String(value))) throw new Error(`${label}不对`);
  return value as T;
}

/** 简称代码：转大写，1 到 16 位字母、数字、- 或 _。 */
export function cleanCode(value: unknown, label: string): string {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,16}$/.test(code)) throw new Error(`${label}需要 1 到 16 位字母、数字、- 或 _`);
  return code;
}

/** 必填名称，1 到 max 个字符。 */
export function cleanName(value: unknown, label: string, max = 80): string {
  const name = String(value ?? "").trim();
  if (!name || name.length > max) throw new Error(`${label}需要 1 到 ${max} 个字符`);
  return name;
}
