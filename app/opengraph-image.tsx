// 动态 OG 分享图（next/og / Satori）：用于社交平台与 IM 链接预览。
// 刻意只用拉丁字符——Satori 内置字体不含中文字形，直接写中文会渲染成方块。
import { ImageResponse } from "next/og";

export const alt = "Zhixue · RAG-based course Q&A assistant";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #0b0b0f 0%, #1f2937 100%)",
          color: "#ffffff",
          padding: 64,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#111111",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            Z
          </div>
          <div style={{ fontSize: 30, letterSpacing: 10, color: "#e5e7eb" }}>ZHIXUE</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 78, fontWeight: 700, lineHeight: 1.1 }}>
            RAG Course Q&amp;A
          </div>
          <div style={{ fontSize: 34, color: "#9ca3af" }}>
            Citations · PDF viewer · Quiz agent
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#6b7280" }}>
          <span>Next.js 15</span>
          <span>·</span>
          <span>AI SDK</span>
          <span>·</span>
          <span>Supabase pgvector</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
