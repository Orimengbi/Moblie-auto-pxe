"use client";

/** 连外层布局都渲染不出来时的兜底。这时主题和组件库可能都没加载，只用最朴素的 HTML。 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, background: "#fff", color: "#111" }}>
        <h1 style={{ fontSize: 20 }}>控制台出错了</h1>
        <p style={{ color: "#b00020" }}>
          {error.message || "页面渲染失败"}
          {error.digest ? `（编号 ${error.digest}）` : ""}
        </p>
        <button type="button" onClick={reset} style={{ marginRight: 8 }}>
          重试
        </button>
        <button type="button" onClick={() => window.location.reload()}>
          刷新整页
        </button>
      </body>
    </html>
  );
}
