// 向量化接口：把指定文档下 embedding 仍为 NULL 的 chunks 批量向量化并回写。
// 幂等：只处理 embedding 为 NULL 的行，重复调用会继续补齐未完成的部分。

import { NextResponse } from "next/server";
import { EMBED_BATCH_SIZE, embedTexts } from "@/lib/embedding";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildApiError } from "@/lib/api-error";
import type { ApiErrorBody, ApiErrorCode } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 回写时每轮并行的 UPDATE 数量，兼顾速度与连接占用 */
const UPDATE_CONCURRENCY = 8;

interface PendingChunk {
  id: string;
  content: string;
  page_num: number;
}

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  // ── 入参校验 ──
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_BODY", '请求体必须是 JSON，例如 { "documentId": "6f1c…" }', 400);
  }

  const documentId =
    typeof body === "object" && body !== null && "documentId" in body
      ? (body as { documentId: unknown }).documentId
      : undefined;

  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    return fail("INVALID_BODY", "documentId 缺失或不是合法 UUID", 400);
  }

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  // ── 查询待向量化的切片 ──
  const { data, error: queryError } = await supabase
    .from("chunks")
    .select("id, content, page_num")
    .eq("document_id", documentId)
    .is("embedding", null)
    .order("page_num", { ascending: true })
    .order("id", { ascending: true });

  if (queryError) {
    return fail("DB_QUERY_FAILED", `查询待向量化 chunks 失败：${queryError.message}`, 500);
  }

  const chunks = (data ?? []) as PendingChunk[];
  if (chunks.length === 0) {
    return NextResponse.json({ embedded: 0 });
  }

  // ── 分批向量化 + 回写 ──
  let embedded = 0;

  for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH_SIZE) {
    const group = chunks.slice(offset, offset + EMBED_BATCH_SIZE);
    const batchNo = offset / EMBED_BATCH_SIZE + 1;

    let vectors: number[][];
    try {
      vectors = await embedTexts(group.map((chunk) => chunk.content));
    } catch (error) {
      const failure: ApiErrorBody & { embedded: number } = {
        error: {
          code: "EMBEDDING_FAILED",
          message: `第 ${batchNo} 批向量化失败（该批 ${group.length} 条）：${describeError(error)}`,
          failedChunkIds: group.map((chunk) => chunk.id),
        },
        embedded,
      };
      return NextResponse.json(failure, { status: 500 });
    }

    for (let cursor = 0; cursor < group.length; cursor += UPDATE_CONCURRENCY) {
      const slice = group.slice(cursor, cursor + UPDATE_CONCURRENCY);
      const results = await Promise.all(
        slice.map((chunk, index) =>
          supabase
            .from("chunks")
            .update({ embedding: vectors[cursor + index] })
            .eq("id", chunk.id),
        ),
      );

      const failedIds = slice
        .filter((_, index) => results[index].error !== null)
        .map((chunk) => chunk.id);

      if (failedIds.length > 0) {
        const firstError = results.find((result) => result.error !== null)?.error;
        const failure: ApiErrorBody & { embedded: number } = {
          error: {
            code: "DB_UPDATE_FAILED",
            message: `回写 embedding 失败（${failedIds.length} 条）：${firstError?.message ?? "未知错误"}`,
            failedChunkIds: failedIds,
          },
          embedded,
        };
        return NextResponse.json(failure, { status: 500 });
      }

      embedded += slice.length;
    }
  }

  return NextResponse.json({ embedded });
}
