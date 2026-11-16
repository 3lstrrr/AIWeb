// 核心聊天接口：POST { conversationId, question, mode } → 检索 Top-4 → GLM 流式回答（带角标引用）→ 落库。
// 说明：流式响应使用 AI SDK v5 的 toUIMessageStreamResponse()（v4 的 toDataStreamResponse 在 v5 已移除）。

import { NextResponse } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse, streamText } from "ai";
import { CHAT_MODEL } from "@/lib/llm";
import { RetrievalError, retrieve } from "@/lib/retrieval";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildApiError } from "@/lib/api-error";
import { checkInput, checkOutput, PRECISE_REFUSAL } from "@/lib/safety";
import type { ApiErrorBody, ApiErrorCode, ChatMode, Citation, RetrievalResultItem } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 问题长度上限 */
const MAX_QUESTION_LENGTH = 1000;

/** 精排后交给模型的片段数 */
const CONTEXT_TOP_K = 4;

/** 会话标题截断长度 */
const TITLE_LENGTH = 30;

/** 引用卡片摘要截断长度 */
const SNIPPET_LENGTH = 200;

const BASE_SYSTEM_PROMPT = `你是「智学」，一位面向大学生的课程答疑助手。

【工作模式】
- precise 模式：你只能依据下方 context 作答。context 中没有的内容，
  必须回答「所上传资料中未找到与该问题直接相关的内容。您可以切换到探索模式尝试获得补充回答。」
  严禁编造、严禁使用 context 之外的知识。
- explore 模式：可以结合你的通用知识，但必须明确区分两类内容：
  来自资料的部分标注「（资料依据）」，模型补充的部分标注「（模型补充）」。

【引用规则】
- 凡是来自 context 的内容，在句末添加 [1] [2] 角标，
  角标编号对应 context 中片段的顺序号
- 同一句可引用多个来源，如 [1][3]
- 不允许引用不存在的编号

【context】
（检索到的片段，格式：[n] (文档名 · 第x页) 内容）`;

/** 把检索片段拼成 context，并在末尾声明当前模式（否则模型无法判断该用哪套规则） */
function buildSystemPrompt(mode: ChatMode, chunks: RetrievalResultItem[]): string {
  const context =
    chunks.length > 0
      ? chunks
          .map(
            (chunk, index) =>
              `[${index + 1}] (${chunk.docTitle} · 第${chunk.pageNum}页) ${chunk.content}`,
          )
          .join("\n\n")
      : "（本次检索未命中任何片段）";

  const modeLine =
    mode === "precise"
      ? "当前模式：precise 精确模式 —— 只允许使用 context，命中不到就按拒答文案回答。"
      : "当前模式：explore 探索模式 —— 允许补充模型知识，但必须用「（资料依据）」「（模型补充）」分别标注。";

  return `${BASE_SYSTEM_PROMPT}\n${context}\n\n---\n${modeLine}`;
}

/** 从回答里提取实际引用到的角标编号，越界编号丢弃（模型偶尔会编造编号） */
function extractCitedIndexes(text: string, available: number): number[] {
  const indexes = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= available) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 不经过模型的固定回复：照常落库，并用同一套 UI 消息流协议返回，
 * 前端无需为「被拦截」单独写一套渲染逻辑。
 */
async function replyWithoutModel(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  conversationId: string,
  question: string,
  reply: string,
): Promise<Response> {
  const { error: userError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: question,
  });
  if (userError) {
    return fail("DB_INSERT_FAILED", `保存用户消息失败：${userError.message}`, 500);
  }

  const { error: assistantError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: reply,
    citations: [],
  });
  if (assistantError) {
    return fail("DB_INSERT_FAILED", `保存回复失败：${assistantError.message}`, 500);
  }

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { citations: [] } });
      writer.write({ type: "text-start", id: "safety-reply" });
      writer.write({ type: "text-delta", id: "safety-reply", delta: reply });
      writer.write({ type: "text-end", id: "safety-reply" });
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

interface ChatRequestBody {
  conversationId: string;
  question: string;
  mode: ChatMode;
  /** 限定检索范围；不传表示全库 */
  docIds?: string[];
}

type ParseResult = { ok: true; value: ChatRequestBody } | { ok: false; message: string };

function parseBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      message: '请求体必须是 JSON 对象，例如 { "conversationId": "…", "question": "…", "mode": "precise" }',
    };
  }

  const { conversationId, question, mode, docIds } = body as {
    conversationId?: unknown;
    question?: unknown;
    mode?: unknown;
    docIds?: unknown;
  };

  if (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId)) {
    return { ok: false, message: "conversationId 缺失或不是合法 UUID" };
  }
  if (typeof question !== "string" || question.trim().length === 0) {
    return { ok: false, message: "question 不能为空" };
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return { ok: false, message: `question 过长（${question.length} 字符），上限 ${MAX_QUESTION_LENGTH}` };
  }

  // mode 缺省按 precise 处理（更安全：宁可不答也不编造）
  const parsedMode = mode === undefined || mode === null ? "precise" : mode;
  if (parsedMode !== "precise" && parsedMode !== "explore") {
    return { ok: false, message: "mode 只能是 precise 或 explore" };
  }

  let parsedDocIds: string[] | undefined;
  if (docIds !== undefined && docIds !== null) {
    if (
      !Array.isArray(docIds) ||
      docIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))
    ) {
      return { ok: false, message: "docIds 必须是 UUID 字符串数组" };
    }
    parsedDocIds = docIds;
  }

  return {
    ok: true,
    value: { conversationId, question: question.trim(), mode: parsedMode, docIds: parsedDocIds },
  };
}

export async function POST(request: Request) {
  // ── 1. 入参校验 ──
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_BODY", "请求体必须是 JSON", 400);
  }

  const parsed = parseBody(body);
  if (!parsed.ok) return fail("INVALID_BODY", parsed.message, 400);

  const { conversationId, question, mode, docIds } = parsed.value;

  // ── 2. 服务端依赖 ──
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  // ── 3. 确保会话存在（不存在则以本问题为标题新建；已存在则不改动标题）──
  const { error: conversationError } = await supabase.from("conversations").upsert(
    { id: conversationId, title: question.slice(0, TITLE_LENGTH) },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (conversationError) {
    return fail("DB_INSERT_FAILED", `创建会话失败：${conversationError.message}`, 500);
  }

  // ── 4. 输入安全检测：命中注入 / 敏感词则不调模型，直接返回固定回复 ──
  const inputCheck = checkInput(question);
  if (inputCheck.blocked && inputCheck.reply) {
    console.warn(`[safety] 输入被拦截（${inputCheck.action}）：${question.slice(0, 60)}`);
    return replyWithoutModel(supabase, conversationId, question, inputCheck.reply);
  }

  // ── 5. 检索 ──
  let chunks: RetrievalResultItem[];
  try {
    chunks = await retrieve({ query: question, docIds, topK: CONTEXT_TOP_K });
  } catch (error) {
    if (error instanceof RetrievalError) {
      const code: ApiErrorCode = error.stage === "embedding" ? "EMBEDDING_FAILED" : "DB_QUERY_FAILED";
      return fail(code, error.message, 500);
    }
    return fail("INTERNAL_ERROR", describeError(error), 500);
  }

  // precise 模式检索不到任何依据：直接给标准拒答，既省 token 又保证措辞稳定
  if (mode === "precise" && chunks.length === 0) {
    return replyWithoutModel(supabase, conversationId, question, PRECISE_REFUSAL);
  }

  // ── 6. 先落用户消息（即使后续流式失败，提问也有记录）──
  const { error: userMessageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: question,
  });
  if (userMessageError) {
    return fail("DB_INSERT_FAILED", `保存用户消息失败：${userMessageError.message}`, 500);
  }

  // ── 6. 流式生成 ──
  // 打印实际使用的模型，便于核对确实是免费的 glm-4.7-flash（不是付费的 glm-4.7）
  console.log(
    `[chat] model=${CHAT_MODEL.modelId} mode=${mode} context=${chunks.length} 段 conversation=${conversationId}`,
  );

  const result = streamText({
    model: CHAT_MODEL,
    system: buildSystemPrompt(mode, chunks),
    prompt: question,
    temperature: 0.3,
    maxOutputTokens: 2048,
    onError: ({ error }) => {
      // 流已开始后无法再改 HTTP 状态，只能记录；客户端会收到 error 事件
      console.error("[chat] 生成失败：", describeError(error));
    },
    onFinish: async ({ text }) => {
      try {
        // 输出兜底：空回复 / 命中敏感词 → 降级文案；超长 → 截断（流式已下发的内容无法撤回，此处保证落库口径一致）
        const { text: safeText, action } = checkOutput(text);
        if (action !== "ok") {
          console.warn(`[safety] 输出降级（${action}）：${text.slice(0, 80)}`);
        }

        // 只保留回答里真正引用到的角标，避免把 8 个候选都塞进 citations
        const usedCitations: Citation[] = extractCitedIndexes(safeText, chunks.length).map((index) => {
          const chunk = chunks[index - 1];
          return {
            index,
            document_id: chunk.documentId,
            doc_title: chunk.docTitle,
            page_num: chunk.pageNum,
            snippet: chunk.content.slice(0, SNIPPET_LENGTH),
          };
        });

        const { error: assistantError } = await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: safeText,
          citations: usedCitations,
        });
        if (assistantError) throw new Error(assistantError.message);

        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);
      } catch (error) {
        console.error("[chat] 助手回复落库失败：", describeError(error));
      }
    },
  });

  // 随消息下发全部候选引用（角标 1..N），客户端据此渲染引用卡片；
  // 正文里实际用了哪几条，由客户端按 [n] 过滤（服务端在 onFinish 时才知道最终文本）。
  const citationsForClient: Citation[] = chunks.map((chunk, index) => ({
    index: index + 1,
    document_id: chunk.documentId,
    doc_title: chunk.docTitle,
    page_num: chunk.pageNum,
    snippet: chunk.content.slice(0, SNIPPET_LENGTH),
  }));

  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => (part.type === "start" ? { citations: citationsForClient } : undefined),
  });
}
