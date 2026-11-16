// 智谱 Embedding 实现：embedding-3，显式 dimensions=1024（默认输出 2048 维，不传会与 pgvector 的 vector(1024) 不匹配）。
// 批量 32 条/次；单批失败按 1s / 2s / 4s 指数退避重试 3 次，仍失败则抛出带中文说明的 EmbeddingError。

import OpenAI from "openai";
import { getEnv } from "./env";
import { ZHIPU_BASE_URL } from "./llm";

/** 智谱向量模型名 */
export const EMBED_MODEL = "embedding-3";

/** 向量维度：必须与 supabase/migrations/001_init.sql 的 vector(1024) 一致 */
export const EMBED_DIM = 1024;

/** 单批文本条数上限 */
export const EMBED_BATCH_SIZE = 32;

/** 单批最多重试次数 */
const MAX_RETRIES = 3;

/** 第 n 次重试前的等待时间（毫秒） */
const RETRY_DELAY_MS = [1000, 2000, 4000];

/** 向量化失败：携带批次信息，供 API 层定位到具体 chunk */
export class EmbeddingError extends Error {
  /** 第几批（从 0 开始） */
  readonly batchIndex: number;

  /** 该批文本条数 */
  readonly batchSize: number;

  constructor(message: string, batchIndex: number, batchSize: number) {
    super(message);
    this.name = "EmbeddingError";
    this.batchIndex = batchIndex;
    this.batchSize = batchSize;
  }
}

let cachedClient: OpenAI | undefined;

/**
 * 复用同一个 OpenAI 客户端；密钥只从 process.env.ZHIPU_API_KEY 读取（经 getEnv 校验）。
 * maxRetries: 0 —— 关掉 SDK 内置重试，否则会与本文件的 3 次退避重试叠加成 12 次请求；
 * timeout: 30s —— 默认 10 分钟，在 Serverless 里会撞上函数超时。
 */
function getClient(): OpenAI {
  if (!cachedClient) {
    let apiKey: string;
    try {
      apiKey = getEnv().ZHIPU_API_KEY;
    } catch (error) {
      // 配置缺失不可重试：直接抛出，避免白等 1s+2s+4s
      throw new NonRetryableError(error instanceof Error ? error.message : String(error));
    }
    cachedClient = new OpenAI({
      apiKey,
      baseURL: ZHIPU_BASE_URL,
      maxRetries: 0,
      timeout: 30_000,
    });
  }
  return cachedClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 本地校验失败（维度/条数不符），重试也不会成功，用于跳过退避重试 */
class NonRetryableError extends Error {}

/** 网络抖动与限流/5xx 才重试；4xx（如 401 密钥错误）与本地校验错误立即失败，避免无意义等待 */
function isRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableError) return false;
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    if (status === undefined) return true;
    return status === 408 || status === 429 || status >= 500;
  }
  return true;
}

function describeError(error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    return `智谱接口返回 ${error.status ?? "未知状态"}：${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** 单批请求：按 index 归位并校验维度 */
async function requestEmbeddings(batch: string[]): Promise<number[][]> {
  const response = await getClient().embeddings.create({
    model: EMBED_MODEL,
    input: batch,
    // 关键：不传则输出 2048 维，写入 vector(1024) 会直接报错
    dimensions: EMBED_DIM,
  });

  const sorted = [...response.data].sort((a, b) => a.index - b.index);
  if (sorted.length !== batch.length) {
    throw new NonRetryableError(`返回条数 ${sorted.length} 与请求条数 ${batch.length} 不一致`);
  }

  return sorted.map((item) => {
    if (item.embedding.length !== EMBED_DIM) {
      throw new NonRetryableError(
        `向量维度为 ${item.embedding.length}，期望 ${EMBED_DIM}（请确认已显式传 dimensions）`,
      );
    }
    return item.embedding;
  });
}

/** 单批向量化 + 指数退避重试 */
async function embedBatchWithRetry(batch: string[], batchIndex: number): Promise<number[][]> {
  let lastError: unknown;
  let attempts = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    attempts += 1;
    try {
      return await requestEmbeddings(batch);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_RETRIES) break;
      await sleep(RETRY_DELAY_MS[attempt] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1]);
    }
  }

  const retried = attempts - 1;
  const retryNote =
    retried > 0 ? `已重试 ${retried} 次（退避 1s/2s/4s）` : "该错误不可重试";

  throw new EmbeddingError(
    `第 ${batchIndex + 1} 批（${batch.length} 条文本）向量化失败，${retryNote}：${describeError(lastError)}`,
    batchIndex,
    batch.length,
  );
}

/**
 * 批量向量化（文档入库侧）。
 * @param texts 待向量化文本；会按 EMBED_BATCH_SIZE 自动分批
 * @returns 与 texts 顺序一一对应的 1024 维向量
 * @throws EmbeddingError 某批重试后仍失败
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // 空串会被接口拒绝，统一替换为单个空格（保留条数与顺序）
  const normalized = texts.map((text) => text.replace(/\s+/g, " ").trim() || " ");

  const vectors: number[][] = [];
  for (let offset = 0; offset < normalized.length; offset += EMBED_BATCH_SIZE) {
    const batch = normalized.slice(offset, offset + EMBED_BATCH_SIZE);
    const batchVectors = await embedBatchWithRetry(batch, offset / EMBED_BATCH_SIZE);
    vectors.push(...batchVectors);
  }

  return vectors;
}

/**
 * 单条向量化（查询侧）。
 * 必须与文档侧使用同一模型、同一维度，否则余弦相似度无意义。
 */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
