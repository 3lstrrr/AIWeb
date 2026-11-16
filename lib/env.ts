// 环境变量校验：zod 解析 process.env，缺失或格式错误时抛出中文错误。
// 采用惰性解析（getEnv 首次调用时校验并缓存）：next build 会执行路由模块顶层代码，
// 若在模块作用域直接抛错会导致「收集页面数据」阶段构建失败。启动期校验由 instrumentation.ts 触发。

import { z } from "zod";

/** Supabase 项目地址校验（不依赖 zod 各版本内置 url 校验器的差异，空值时只报一条中文错误） */
const supabaseUrl = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (!value) {
      ctx.addIssue({
        code: "custom",
        message: "不能为空：请填写形如 https://xxxxxxxx.supabase.co 的项目地址",
      });
      return;
    }
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "必须是 http(s) 开头的合法 URL，例如 https://xxxxxxxx.supabase.co",
      });
    }
  });

/**
 * 三个必需变量：
 * - ZHIPU_API_KEY：智谱开放平台 Key，LLM / Embedding / Rerank 共用
 * - NEXT_PUBLIC_SUPABASE_URL：会被打包进浏览器代码
 * - SUPABASE_SERVICE_ROLE_KEY：服务端专用，绝不能带 NEXT_PUBLIC_ 前缀
 */
const envSchema = z.object({
  ZHIPU_API_KEY: z
    .string()
    .trim()
    .min(1, "不能为空：请到 https://open.bigmodel.cn 获取 API Key 并填入 .env.local"),
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .trim()
    .min(1, "不能为空：请填写 Supabase service_role 密钥（服务端专用，不可加 NEXT_PUBLIC_ 前缀）"),
});

export type Env = z.infer<typeof envSchema>;

/** 把 zod 报错整理成「变量名 — 原因」清单，一次性列出全部问题而不是只报第一个 */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ✗ ${issue.path.join(".") || "(root)"} — ${issue.message}`)
    .join("\n");
}

let cachedEnv: Env | undefined;

/**
 * 读取并校验环境变量（首次调用后缓存）。
 * 变量不存在时 process.env.X 为 undefined，归一成空串以走自定义中文文案。
 * @throws 任一变量缺失或格式错误时抛出带中文清单的 Error
 */
export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse({
    ZHIPU_API_KEY: process.env.ZHIPU_API_KEY ?? "",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  });

  if (!result.success) {
    throw new Error(
      [
        "",
        "【环境变量校验失败】以下配置缺失或格式不正确：",
        "请检查项目根目录的 .env.local（字段说明见 .env.example）：",
        formatIssues(result.error),
        "",
        "提示：.env.local 修改后需要重启 dev server 才会重新读取。",
        "",
      ].join("\n"),
    );
  }

  cachedEnv = result.data;
  return cachedEnv;
}
