/**
 * 列表搜索框：一次贴多个 SN 等。有逗号、分号、换行时拆成几项，任一项匹配就算；
 * 只有空格时照旧整句匹配（「Gigabyte G894」不会变成两项）。不区分大小写。客户端也用，不要引 Node 模块。
 */
export function searchTerms(query: string): string[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  if (!/[,;，；、\n\t]/.test(text)) return [text];
  return [...new Set(text.split(/[,;，；、\n\t]+/).map((item) => item.trim()).filter(Boolean))];
}

/** haystack 是要搜的字段拼起来的文字；terms 为空时都算匹配。 */
export function matchesSearch(haystack: string, terms: string[]): boolean {
  if (!terms.length) return true;
  const text = haystack.toLowerCase();
  return terms.some((term) => text.includes(term));
}

/**
 * 单行输入框粘贴多行时浏览器会把换行吞掉、几个 SN 粘成一串。接住粘贴，把换行、制表符换成「, 」。
 * 用法：<TextField slotProps={{ htmlInput: { onPaste: pasteAsList(setValue) } }} />
 */
export function pasteAsList(set: (value: string) => void) {
  return (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!/[\r\n\t]/.test(pasted.trim())) return;
    event.preventDefault();
    const input = event.currentTarget;
    const joined = pasted
      .split(/[\r\n\t]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    set(`${input.value.slice(0, start)}${joined}${input.value.slice(end)}`);
  };
}
