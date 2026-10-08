/** 纯文本处理，不依赖 Node 模块：页面组件引用的 inventory.ts 也用它，不能带进 child_process。 */

/** 脚本输出里 `===标记 名字===` 分开的段：采集（PXEINV）、光模块（PXEOPT）、监控（PXEMON）都用这种格式。 */
export function markedSections(text: string, tag: string): { head: string; body: string }[] {
  const marks = [...text.matchAll(new RegExp(`^===${tag} (.+?)(?:===)?$`, "gm"))];
  return marks.map((mark, index) => {
    const start = (mark.index ?? 0) + mark[0].length + 1;
    const end = index + 1 < marks.length ? (marks[index + 1].index ?? text.length) : text.length;
    return { head: mark[1].trim(), body: text.slice(start, end) };
  });
}
