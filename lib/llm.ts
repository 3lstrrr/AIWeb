// 智谱 GLM 对话模型客户端（OpenAI 兼容协议）。
// 重要：GLM-4.7-Flash 免费，标准版 GLM-4.7 付费，模型名必须精确匹配 "glm-4.7-flash"（带 -flash 后缀）。

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/** 智谱开放平台 OpenAI 兼容入口 */
export const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

/**
 * 智谱 provider 实例：需要别的模型时用 zhipu("<model-id>") 取。
 * 这里直接读 process.env 而不走 getEnv()：模块顶层抛错会让 next build 收集路由数据时失败；
 * 密钥缺失由 instrumentation.ts 与 getEnv() 在启动/请求期给出中文错误，兜底是智谱返回 401。
 */
export const zhipu = createOpenAICompatible({
  name: "zhipu",
  baseURL: ZHIPU_BASE_URL,
  apiKey: process.env.ZHIPU_API_KEY,
});

/**
 * 免费档对话模型：GLM-4.7-Flash。
 * 写成 "glm-4.7" 会落到付费标准版，请勿去掉 -flash 后缀。
 */
export const CHAT_MODEL = zhipu("glm-4.7-flash");
