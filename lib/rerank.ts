// 精排封装：调用智谱 bge-reranker-large（免费）对向量召回的候选片段重新打分。
// 降级策略：接口异常 / 超时 / 返回结构异常时返回 null，由调用方保留向量检索原顺序继续流程，
//           即「精排不可用 = 退化为纯向量检索」，绝不因为精排失败让整个问答失败。

import { getEnv } from "./env";
import { ZHIPU_BASE_URL } from "./llm";

/** 免费重排模型 */
export const RERANK_MODEL = "bge-reranker-large";

/** 精排接口地址（智谱 tools 聚合接口） */
const RERANK_URL = `${ZHIPU_BASE_URL}/tools`;

/** 精排超时：超过就降级，不拖垮整个请求 */
const RERANK_TIMEOUT_MS = 15_000;

/** 单条精排结果 */
export interface RerankHit {
  /** 对应候选数组下标 */
  index: number;
  /** 相关性分数，越大越相关 */
  score: number;
}

interface RerankApiItem {
  index?: number;
  relevance_score?: number;
}

interface RerankApiResponse {
  results?: RerankApiItem[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 对候选片段精排。
 * @param query 用户问题
 * @param documents 候选片段正文（顺序需与调用方一致）
 * @param topN 只保留相关性最高的 topN 条
 * @returns 按分数降序的命中列表；接口不可用时返回 null（调用方走降级）
 */
export async function rerank(
  query: string,
  documents: string[],
  topN: number,
): Promise<RerankHit[] | null> {
  if (documents.length === 0) return [];

  try {
    const { ZHIPU_API_KEY } = getEnv();

    const response = await fetch(RERANK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ZHIPU_API_KEY}`,
      },
      body: JSON.stringify({
        tool: "rerank",
        model: RERANK_MODEL,
        query,
        documents,
        top_n: Math.min(topN, documents.length),
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`);
    }

    const payload = (await response.json()) as RerankApiResponse | RerankApiItem[];
    const list = Array.isArray(payload) ? payload : payload.results;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("返回结果为空或结构不符合预期");
    }

    const hits: RerankHit[] = [];
    for (const item of list) {
      const index = item.index;
      const score = item.relevance_score;
      if (typeof index !== "number" || typeof score !== "number") continue;
      if (index < 0 || index >= documents.length) continue;
      hits.push({ index, score });
    }

    if (hits.length === 0) {
      throw new Error("返回结果中没有可用的 index / relevance_score");
    }

    return hits.sort((a, b) => b.score - a.score);
  } catch (error) {
    // 降级：不抛错，让调用方沿用向量检索顺序
    console.warn(`[rerank] 精排不可用，降级为向量检索原顺序：${describeError(error)}`);
    return null;
  }
}
