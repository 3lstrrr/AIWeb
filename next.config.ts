// Next.js 配置：把 pdf-parse 保留为运行时外部依赖。
// pdf-parse 内部用动态 require 加载 ./pdf.js/<version>/build/pdf.js，打包器无法静态解析，必须走 Node 原生 require。
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
