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
