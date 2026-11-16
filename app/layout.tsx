// 应用根布局：自托管字体、全站元信息（title/description/OG/图标）与全局 toast 容器。
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * 自托管 Geist（OFL-1.1，见 app/fonts/NOTICE.md）。
 * 不用 next/font/google：本机与部分内网环境访问不到 fonts.googleapis.com，会导致构建失败。
 * 自托管版无第三方握手、由 next/font 预加载并自动内联字体声明；中文回落到系统字体栈。
 */
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "400",
  fallback: ["system-ui", "PingFang SC", "Microsoft YaHei", "sans-serif"],
});

const SITE_NAME = "智学";
const SITE_TITLE = "智学 · AI 课程答疑助手";
const SITE_DESCRIPTION =
  "上传课件与文献构建专属知识库，基于 RAG 检索增强生成作答，每条回答附带原文引用与页码范围，点击即可定位高亮。";

/** 站点根地址：优先 NEXT_PUBLIC_SITE_URL，其次 Vercel 注入的 VERCEL_URL，本地回落 localhost */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["RAG", "课程答疑", "AI 助教", "知识库问答", "引用溯源", "智能出题", "Next.js"],
  authors: [{ name: "智学团队" }],
  creator: "智学团队",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  // 移动端浏览器不要自动把数字识别成电话号码，避免污染正文样式
  formatDetection: { telephone: false, email: false, address: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} font-sans`}>
      <body className="antialiased">
        {children}
        {/* 全局提示：所有请求失败都用中文 toast 呈现 */}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
