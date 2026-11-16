// Next.js 服务端启动钩子：进程启动时立即校验环境变量，缺失/格式错误时打印中文错误提示。
// 说明：这里只提示不中断启动，保证静态页面（首页/上传页）仍可访问；
//       真正读写模型或数据库的接口会因 lib/env.ts 抛错而明确失败，不会静默带病运行。
export async function register(): Promise<void> {
  // 只在 Node.js 服务端运行时校验（Edge 运行时不需要这些变量）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 构建阶段跳过：构建不应依赖运行期密钥
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    // 显式触发一次 zod 校验（lib/env.ts 为惰性解析，避免构建期失败）
    const { getEnv } = await import("./lib/env");
    getEnv();
  } catch (error) {
    const banner = "==================== 环境变量校验未通过 ====================";
    console.error(
      [
        "",
        banner,
        error instanceof Error ? error.message : String(error),
        "应用仍会启动，但所有涉及智谱模型 / Supabase 的接口都会失败。",
        banner,
        "",
      ].join("\n"),
    );
  }
}
