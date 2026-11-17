// 知识图谱接口：取文档切片 → 单次模型调用抽取实体关系 → 结果写回 documents.graph_json 做缓存。
// 说明：本项目模型为智谱 GLM（lib/llm.ts 的 CHAT_MODEL），不再有 DeepSeek 配置。

import { NextResponse } from "next/server";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { buildApiError } from "@/lib/api-error";
import { getEnv } from "@/lib/env";
import { CHAT_MODEL } from "@/lib/llm";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ApiErrorBody, ApiErrorCode, GraphEdge, GraphNode, KnowledgeGraph } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 上限：每文档节点/边数量 */
const MAX_NODES = 20;
const MAX_EDGES = 30;

/** 抽样：最多取多少个切片、每个切片多少字符（控制 prompt 体积） */
const SAMPLE_CHUNK_COUNT = 40;
const SAMPLE_CHARS_PER_CHUNK = 400;
const SAMPLE_TOTAL_CHARS = 12_000;

/** Postgres 未定义列的报错码 */
const UNDEFINED_COLUMN = "42703";

const graphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().min(1).max(40),
        type: z.string().min(1).max(10),
      }),
    )
    .min(1)
    .max(MAX_NODES),
  edges: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        relation: z.string().min(1).max(12),
      }),
    )
    .max(MAX_EDGES),
});

interface ChunkRow {
  content: string;
  page_num: number;
}

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 清洗模型输出：去重、丢弃悬空边与自环、按上限截断 */
function sanitizeGraph(raw: { nodes: GraphNode[]; edges: GraphEdge[] }): KnowledgeGraph {
  const nodeMap = new Map<string, GraphNode>();
  for (const node of raw.nodes) {
    if (nodeMap.size >= MAX_NODES) break;
    const id = node.id.trim();
    if (!id || nodeMap.has(id)) continue;
    nodeMap.set(id, { id, label: node.label.trim(), type: node.type.trim() });
  }

  const seenEdge = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const edge of raw.edges) {
    if (edges.length >= MAX_EDGES) break;
    const source = edge.source.trim();
    const target = edge.target.trim();
    if (source === target) continue;
    if (!nodeMap.has(source) || !nodeMap.has(target)) continue;
    const key = `${source}→${target}:${edge.relation}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    edges.push({ source, target, relation: edge.relation.trim() });
  }

  return { nodes: [...nodeMap.values()], edges, generatedAt: new Date().toISOString() };
}

const GRAPH_SYSTEM = "你是课件知识图谱抽取器。只输出结构化结果，不要解释。";

function buildGraphPrompt(sample: string): string {
  return `从下面的课件片段中抽取核心概念与关系。

要求：
- 节点 ${Math.min(8, MAX_NODES)}~${MAX_NODES} 个：只抽片段中真实出现的名词性概念（术语、方法、公式、模型、指标），不要编造。
- 边 ${Math.min(10, MAX_EDGES)}~${MAX_EDGES} 条：relation 用 2~6 个字的动词短语（如「属于」「用于」「包含」「依赖」「对比」）。
- id 用英文小写加下划线（如 gradient_descent），label 用课件里的中文原词。
- type 只能取：概念 / 方法 / 公式 / 结构 / 应用。
- 每条边的 source / target 必须是已列出的节点 id。

课件片段：
${sample}`;
}

/** 从可能带 markdown 围栏的文本里抠出 JSON 并校验 */
function tryParseGraph(text: unknown): KnowledgeGraph | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;

  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = graphSchema.safeParse(JSON.parse(cleaned.slice(start, end + 1)));
    if (!parsed.success) return null;
    const graph = sanitizeGraph(parsed.data);
    return graph.nodes.length > 0 ? graph : null;
  } catch {
    return null;
  }
}

/**
 * 抽图：结构化输出优先；失败后先用错误里携带的原文抢救一次，
 * 再退回「纯文本 JSON + 服务端解析」。避免一次格式抖动就整功能报错。
 */
async function extractGraph(sample: string): Promise<KnowledgeGraph> {
  try {
    const { object } = await generateObject({
      model: CHAT_MODEL,
      schema: graphSchema,
      temperature: 0.2,
      // 20 节点 + 30 边的中文 JSON 很容易超过 2k token，被截断就会「没有返回」
      maxOutputTokens: 4096,
      maxRetries: 1,
      system: GRAPH_SYSTEM,
      prompt: buildGraphPrompt(sample),
    });
    return sanitizeGraph(object);
  } catch (error) {
    const reason = describeError(error);
    console.warn(`[graph] generateObject 失败，尝试兜底：${reason}`);

    // 有些实现会把「解析失败的原文」挂在 error.text 上，先抢救
    const rescued = tryParseGraph((error as { text?: unknown }).text);
    if (rescued) return rescued;

    const { text } = await generateText({
      model: CHAT_MODEL,
      temperature: 0.2,
      maxOutputTokens: 4096,
      system: `${GRAPH_SYSTEM}
必须只输出一个 JSON 对象，形如 {"nodes":[{"id":"...","label":"...","type":"..."}],"edges":[{"source":"...","target":"...","relation":"..."}]}，
不要 markdown 代码块，不要任何解释文字。`,
      prompt: buildGraphPrompt(sample),
    });

    const parsed = tryParseGraph(text);
    if (parsed) return parsed;

    throw new Error(`模型没有返回可解析的图谱 JSON（${reason}）`);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_BODY", "请求体必须是 JSON，例如 { \"documentId\": \"…\" }", 400);
  }

  const { documentId, refresh } = (body ?? {}) as { documentId?: unknown; refresh?: unknown };
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    return fail("INVALID_BODY", "documentId 缺失或不是合法 UUID", 400);
  }

  try {
    getEnv();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  // ── 读文档与缓存 ──
  const { data: document, error: documentError } = await supabase
    .from("documents")
    .select("id, title, graph_json")
    .eq("id", documentId)
    .maybeSingle();

  if (documentError) {
    if (documentError.code === UNDEFINED_COLUMN) {
      return fail(
        "MIGRATION_REQUIRED",
        "documents 表缺少 graph_json 字段：请在 Supabase SQL Editor 执行 supabase/migrations/002_add_graph_json.sql",
        500,
      );
    }
    return fail("DB_QUERY_FAILED", `读取文档失败：${documentError.message}`, 500);
  }

  if (!document) {
    return fail("DOCUMENT_NOT_FOUND", "文档不存在", 404);
  }

  const cached = (document as { graph_json?: KnowledgeGraph | null }).graph_json;
  if (cached && !refresh) {
    return NextResponse.json({ graph: cached, cached: true });
  }

  // ── 取切片（抽样控制 prompt 体积）──
  const { data: chunkRows, error: chunkError } = await supabase
    .from("chunks")
    .select("content, page_num")
    .eq("document_id", documentId)
    .order("page_num", { ascending: true })
    .limit(SAMPLE_CHUNK_COUNT);

  if (chunkError) {
    return fail("DB_QUERY_FAILED", `读取切片失败：${chunkError.message}`, 500);
  }

  const chunks = (chunkRows ?? []) as ChunkRow[];
  if (chunks.length === 0) {
    return fail("EMPTY_DOCUMENT", "该文档还没有切片，请先完成上传与向量化", 422);
  }

  let sample = "";
  for (const chunk of chunks) {
    const piece = `[p${chunk.page_num}] ${chunk.content.slice(0, SAMPLE_CHARS_PER_CHUNK)}\n`;
    if (sample.length + piece.length > SAMPLE_TOTAL_CHARS) break;
    sample += piece;
  }

  // ── 抽图（结构化输出优先，失败自动兜底）──
  let graph: KnowledgeGraph;
  try {
    graph = await extractGraph(sample);
  } catch (error) {
    console.error("[graph] 抽取失败：", error);
    return fail("INTERNAL_ERROR", `图谱生成失败：${describeError(error)}`, 500);
  }

  if (graph.nodes.length === 0) {
    return fail("INTERNAL_ERROR", "模型未抽取到有效节点，请重试", 500);
  }

  const { error: updateError } = await supabase
    .from("documents")
    .update({ graph_json: graph })
    .eq("id", documentId);

  if (updateError) {
    // 缓存写失败不影响本次返回，但要让调用方知道
    console.warn(`[graph] 缓存写入失败：${updateError.message}`);
  }

  return NextResponse.json({ graph, cached: false });
}
