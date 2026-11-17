// Next.js 配置：把 pdf-parse 保留为运行时外部依赖。
// pdf-parse 内部用动态 require 加载 ./pdf.js/<version>/build/pdf.js，打包器无法静态解析，必须走 Node 原生 require。
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],

  async headers() {
    return [
      {
        // pdf.js 的 worker（1.19 MB）。默认是 Cache-Control: public, max-age=0，
        // 等于每次打开原文查看器都要重新下载一遍，首屏慢的主因之一。
        // 内容只在升级 pdfjs-dist 时变化（届时重新复制该文件），因此可以长缓存。
        source: "/pdf.worker.min.mjs",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
