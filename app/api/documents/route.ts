// 文档集合接口：GET 列表（含切片总数与未向量化数，用于展示「就绪 / 处理中」）。

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildApiError } from "@/lib/api-error";
import type { ApiErrorBody, ApiErrorCode, DocumentSummary } from "@/types";

export const runtime = "nodejs";

/** 单次最多返回的文档数 */
const LIST_LIMIT = 100;

/** 统计未向量化切片时的最大扫描行数 */
const PENDING_SCAN_LIMIT = 5000;

interface DocumentRow {
  id: string;
  title: string;
  file_type: string;
  file_size: number;
  page_count: number;
  created_at: string;
  chunks?: Array<{ count: number }>;
}

interface PendingRow {
  document_id: string;
}

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  // chunks(count) 通过外键自动 embed，得到每个文档的切片总数
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, file_type, file_size, page_count, created_at, chunks(count)")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    return fail("DB_QUERY_FAILED", `读取文档列表失败：${error.message}`, 500);
  }

  // 未向量化切片：只取 document_id 一列，在前端侧聚合成每个文档的待处理数
  const { data: pendingRows } = await supabase
    .from("chunks")
    .select("document_id")
    .is("embedding", null)
    .limit(PENDING_SCAN_LIMIT);

  const pendingByDocument = new Map<string, number>();
  for (const row of (pendingRows ?? []) as PendingRow[]) {
    pendingByDocument.set(row.document_id, (pendingByDocument.get(row.document_id) ?? 0) + 1);
  }

  const documents: DocumentSummary[] = ((data ?? []) as DocumentRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    fileType: row.file_type,
    fileSize: Number(row.file_size) || 0,
    pageCount: row.page_count,
    chunkCount: row.chunks?.[0]?.count ?? 0,
    pendingChunks: pendingByDocument.get(row.id) ?? 0,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ documents });
}
