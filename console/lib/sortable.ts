/** 把 key 挪到 to 的位置（按去掉它之后的列表算），返回新顺序。拖动排序用。 */
export function moveKey(keys: string[], key: string, to: number): string[] {
  const from = keys.indexOf(key);
  if (from < 0) return keys;
  const next = keys.filter((item) => item !== key);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, key);
  return next;
}
