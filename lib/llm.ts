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

/**
 * 给请求体注入 thinking 开关的 fetch。
 *
 * 背景（实测）：GLM-4.7-Flash 默认开启深度思考。做图标/出题这类结构化任务时，
 * 模型会把 2048 个输出 token 全花在 reasoning 上（耗时 53 秒、正文 0 字符），
 * 结果就是「模型没有返回响应」。AI SDK 没有对应参数，只能在 HTTP 层补这个字段。
 * 关闭后同一任务 33 秒、reasoning_tokens = 0、正常产出 JSON。
 */
function createThinkingFetch(disable: boolean): typeof fetch {
  return async (input, init) => {
    if (disable && init && typeof init.body === "string") {
      try {
        const payload = JSON.parse(init.body) as Record<string, unknown>;
        payload.thinking = { type: "disabled" };
        return fetch(input, { ...init, body: JSON.stringify(payload) });
      } catch {
        // 请求体不是 JSON 时原样发出
      }
    }
    return fetch(input, init);
  };
}

const structuredProvider = createOpenAICompatible({
  name: "zhipu-structured",
  baseURL: ZHIPU_BASE_URL,
  apiKey: process.env.ZHIPU_API_KEY,
  fetch: createThinkingFetch(true),
});

/**
 * 结构化任务专用模型（出题 Agent / 知识图谱抽取）：关闭深度思考。
 * 问答仍用 CHAT_MODEL，保留推理以获得更好的作答质量。
 */
export const STRUCTURED_MODEL = structuredProvider("glm-4.7-flash");
