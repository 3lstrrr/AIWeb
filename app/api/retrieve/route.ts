// 检索接口：POST { query, docIds?, topK? } → 返回精排后的片段数组（调试页与 P5 聊天接口共用同一套检索）。
// 成功响应为数组；失败沿用统一错误格式 { error: { code, message } }。

import { NextResponse } from "next/server";
import { DEFAULT_TOP_K, RetrievalError, VECTOR_CANDIDATE_COUNT, retrieve } from "@/lib/retrieval";
import { buildApiError } from "@/lib/api-error";
import type { ApiErrorBody, ApiErrorCode } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 问题长度上限，防止超长文本拖垮向量化与精排 */
const MAX_QUERY_LENGTH = 500;

type ParseResult =
  | { ok: true; query: string; docIds?: string[]; topK: number }
  | { ok: false; message: string };

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function parseBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: '请求体必须是 JSON 对象，例如 { "query": "什么是梯度下降" }' };
  }

  const { query, docIds, topK } = body as {
    query?: unknown;
    docIds?: unknown;
    topK?: unknown;
  };

  if (typeof query !== "string" || query.trim().length === 0) {
    return { ok: false, message: "query 不能为空" };
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return { ok: false, message: `query 过长（${query.length} 字符），上限 ${MAX_QUERY_LENGTH}` };
  }

  let parsedDocIds: string[] | undefined;
  if (docIds !== undefined && docIds !== null) {
    if (!Array.isArray(docIds) || docIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
      return { ok: false, message: "docIds 必须是 UUID 字符串数组" };
    }
    parsedDocIds = docIds;
  }

  let parsedTopK = DEFAULT_TOP_K;
  if (topK !== undefined && topK !== null) {
    if (typeof topK !== "number" || !Number.isInteger(topK) || topK < 1 || topK > VECTOR_CANDIDATE_COUNT) {
      return { ok: false, message: `topK 必须是 1~${VECTOR_CANDIDATE_COUNT} 的整数` };
    }
    parsedTopK = topK;
  }

  return { ok: true, query, docIds: parsedDocIds, topK: parsedTopK };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_BODY", '请求体必须是 JSON，例如 { "query": "什么是梯度下降" }', 400);
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return fail("INVALID_BODY", parsed.message, 400);
  }

  try {
    const items = await retrieve({
      query: parsed.query,
      docIds: parsed.docIds,
      topK: parsed.topK,
    });
    return NextResponse.json(items);
  } catch (error) {
    if (error instanceof RetrievalError) {
      const code: ApiErrorCode = error.stage === "embedding" ? "EMBEDDING_FAILED" : "DB_QUERY_FAILED";
      return fail(code, error.message, 500);
    }
    return fail("INTERNAL_ERROR", error instanceof Error ? error.message : String(error), 500);
  }
}
