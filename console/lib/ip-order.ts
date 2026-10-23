/** IP 的排序键：每段补成 3 位（10.0.0.9 → 010.000.000.009），按字符串比就是按数字比。不是 IPv4 的原样返回。 */
export function ipKey(ip: string | undefined): string {
  return ip && /^\d+(\.\d+){3}$/.test(ip) ? ip.split(".").map((part) => part.padStart(3, "0")).join(".") : ip || "";
}

/** 表格里 IP 列的 sortComparator：10.0.0.9 排在 10.0.0.10 前面，不按字符一位一位比。 */
export const ipCompare = (a: string | undefined, b: string | undefined) => ipKey(a).localeCompare(ipKey(b), "en", { numeric: true });
