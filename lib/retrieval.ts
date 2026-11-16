// 检索链路：问题向量化 → match_documents 向量召回 Top-8 → bge-reranker 精排取 Top-K。
// P5 聊天接口与调试页都复用 retrieve()，保证线上与调试行为一致，不会出现两套检索逻辑。

import { embedQuery } from "./embedding";
import { rerank } from "./rerank";
import { getSupabaseAdmin } from "./supabase";
import type { RetrievalResultItem } from "@/types";

/** 向量召回候选数（精排的输入池） */
export const VECTOR_CANDIDATE_COUNT = 8;

/** 精排后返回条数 */
export const DEFAULT_TOP_K = 4;

/** 检索失败的阶段，便于 API 层给出准确错误码 */
export type RetrievalStage = "embedding" | "search" | "document";

export class RetrievalError extends Error {
  readonly stage: RetrievalStage;

  constructor(stage: RetrievalStage, message: string) {
    super(message);
    this.name = "RetrievalError";
    this.stage = stage;
  }
}

/** match_documents RPC 的返回行 */
interface MatchRow {
  id: string;
  document_id: string;
  content: string;
  page_num: number;
  token_count: number;
  score: number;
}

interface DocumentTitleRow {
  id: string;
  title: string;
}

export interface RetrieveParams {
  query: string;
  /** 限定检索的文档范围；为空则全库检索 */
  docIds?: string[];
  topK?: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 执行一次完整检索。
 * @returns 按相关性降序的片段；知识库为空或无命中时返回空数组
 * @throws RetrievalError 向量化 / 向量检索 / 文档标题查询失败
 */
export async function retrieve({
  query,
  docIds,
  topK = DEFAULT_TOP_K,
}: RetrieveParams): Promise<RetrievalResultItem[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const limit = clamp(Math.floor(topK), 1, VECTOR_CANDIDATE_COUNT);

  // 1) 问题向量化（与文档侧同模型、同维度，否则相似度无意义）
  let embedding: number[];
  try {
    embedding = await embedQuery(normalizedQuery);
  } catch (error) {
    throw new RetrievalError("embedding", `问题向量化失败：${describeError(error)}`);
  }

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    throw new RetrievalError("search", describeError(error).trim());
  }

  // 2) 向量召回：docIds 为空时传 null，表示全库检索
  const { data, error: searchError } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    doc_ids: docIds && docIds.length > 0 ? docIds : null,
    match_count: VECTOR_CANDIDATE_COUNT,
  });

  if (searchError) {
    throw new RetrievalError("search", `向量检索失败：${searchError.message}`);
  }

  const rows = (data ?? []) as MatchRow[];
  if (rows.length === 0) return [];

  // 3) 补文档标题（match_documents 只返回 chunk 字段）
  const documentIds = [...new Set(rows.map((row) => row.document_id))];
  const { data: documentRows, error: documentError } = await supabase
    .from("documents")
    .select("id, title")
    .in("id", documentIds);

  if (documentError) {
    throw new RetrievalError("document", `查询文档标题失败：${documentError.message}`);
  }

  const titleMap = new Map<string, string>(
    ((documentRows ?? []) as DocumentTitleRow[]).map((doc) => [doc.id, doc.title]),
  );

  const toItem = (row: MatchRow, score: number, reranked: boolean): RetrievalResultItem => ({
    chunkId: row.id,
    documentId: row.document_id,
    docTitle: titleMap.get(row.document_id) ?? "未知文档",
    content: row.content,
    pageNum: row.page_num,
    score,
    vectorScore: row.score,
    reranked,
  });

  // 4) 精排；rerank 内部已做降级，返回 null 表示精排不可用
  const hits = await rerank(
    normalizedQuery,
    rows.map((row) => row.content),
    limit,
  );

  if (!hits) {
    // 降级：保持 match_documents 的向量相似度顺序（RPC 已按余弦距离升序返回），score 用向量分
    return rows.slice(0, limit).map((row) => toItem(row, row.score, false));
  }

  return hits.slice(0, limit).map((hit) => toItem(rows[hit.index], hit.score, true));
}
