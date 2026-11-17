// 统一 API 错误格式：{ error: { code, message } }。
// 本文件不依赖 next/server，route（服务端）与组件（客户端）都可安全引用。

import type { ApiErrorBody, ApiErrorCode } from "@/types";

/** 构造统一错误响应体，route 里配合 NextResponse.json(body, { status }) 使用 */
export function buildApiError(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}

/** 从任意响应体里提取后端的中文错误信息；取不到则用兜底文案 */
export function readApiError(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

/** 把未知异常转成面向用户的中文文案（断网 / 超时 / 取消各有对应说法） */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    if (/fetch failed|Failed to fetch|NetworkError|ERR_NETWORK|load failed/i.test(message)) {
      return "网络连接失败，请检查网络后重试";
    }
    if (/aborted|AbortError/i.test(message)) {
      return "请求已取消";
    }
    if (/timeout|timed out/i.test(message)) {
      return "请求超时，请稍后重试";
    }
    return message;
  }
  return String(error);
}

/**
 * 把模型供应商的原始报错翻译成「知道下一步该干什么」的中文。
 * 智谱返回的英文/数字错误码对使用者没有意义，尤其是免费档限流。
 */
export function describeModelError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  // 智谱 1305 / HTTP 429：并发或 QPS 超限
  if (/访问量过大|系统繁忙|rate.?limit|too many requests|\b429\b|1305/i.test(raw)) {
    return "模型服务当前限流（智谱免费档在高峰期较常见），通常 30 秒到 3 分钟后恢复。建议：一次只跑一个生成任务、减少题目数量，或错峰重试。";
  }
  // 1113：账户欠费 / 额度不足
  if (/欠费|余额不足|额度|1113|insufficient|quota/i.test(raw)) {
    return "智谱账户额度不足或已欠费，请到 open.bigmodel.cn 充值后重试。";
  }
  if (/401|invalid.*api.?key|Authorization|unauthorized/i.test(raw)) {
    return "智谱 API Key 无效或已过期，请检查 .env.local 里的 ZHIPU_API_KEY。";
  }
  if (/fetch failed|ETIMEDOUT|timeout|aborted/i.test(raw)) {
    return "调用模型超时或网络中断，请稍后重试。";
  }
  return describeError(error);
}
