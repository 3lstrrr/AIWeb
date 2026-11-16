"use client";

import Link from "next/link";

// 根级错误边界：根 layout 自身抛错时接管整页渲染。
// 注意：此时全局 CSS 可能未加载，样式全部内联，不能依赖 Tailwind 类。

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            'ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
          background: "#fafafa",
          color: "#171717",
        }}
      >
        <div style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>应用启动失败</h1>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#666", margin: "0 0 20px" }}>
            页面在初始化时发生异常。常见原因是环境变量缺失或数据库无法连接。
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "none",
                background: "#171717",
                color: "#fff",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              重试
            </button>
            <Link
              href="/"
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "1px solid #e2e2e2",
                background: "#fff",
                color: "#444",
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              返回首页
            </Link>
          </div>
          <p style={{ marginTop: 16, fontSize: 11, color: "#999", wordBreak: "break-all" }}>
            {error.message}
          </p>
        </div>
      </body>
    </html>
  );
}
