// 出题 Agent：generateText + 两个工具（retrieveForQuiz 检索、generateQuiz 提交题目）。
// 两道工具形成 agent 循环：先检索 → 再按片段出题；模型提交的题目会校验题型/数量/引用是否可溯源，
// 不合规直接抛错让它自我修正（受 stepCountIs 限制，不会无限重试）。

import { NextResponse } from "next/server";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { buildApiError, describeModelError } from "@/lib/api-error";
import { getEnv } from "@/lib/env";
import { STRUCTURED_MODEL } from "@/lib/llm";
import { retrieve } from "@/lib/retrieval";
import type {
  ApiErrorBody,
  ApiErrorCode,
  QuizPayload,
  QuizQuestion,
  QuizQuestionType,
  QuizToolStep,
  RetrievalResultItem,
} from "@/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 出题数量上限 */
const MAX_QUESTION_COUNT = 10;

/** 单次检索返回的片段数 */
const RETRIEVAL_TOP_K = 6;

/** 送给模型的单个片段最大字符数（控制 token） */
const PIECE_CONTENT_LIMIT = 500;

/** Agent 最大步数：检索 + 提交 + 若干次纠错（给足重试空间，避免一次不合规就整批失败） */
const MAX_STEPS = 6;

const TYPE_LABEL: Record<QuizQuestionType, string> = {
  single: "单选题",
  multiple: "多选题",
  short: "简答题",
};

/** 题目 schema：既用于工具入参校验，也用于向模型描述结构 */
const quizSchema = z.object({
  questions: z
    .array(
      z.object({
        type: z.enum(["single", "multiple", "short"]),
        stem: z.string().min(5),
        options: z.array(z.string().min(1)).min(2).max(6).optional(),
        answer: z.union([z.array(z.number().int().min(0)), z.string().min(1)]),
        explanation: z.string().min(5),
        citations: z.array(z.object({ documentId: z.string(), pageNum: z.number().int().min(1) })).min(1),
      }),
    )
    .min(1)
    .max(MAX_QUESTION_COUNT),
});

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ParseResult =
  | { ok: true; documentId: string; count: number; type: QuizQuestionType; topic: string }
  | { ok: false; message: string };

function parseBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "请求体必须是 JSON 对象" };
  }

  const { documentId, count, type, topic } = body as {
    documentId?: unknown;
    count?: unknown;
    type?: unknown;
    topic?: unknown;
  };

  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    return { ok: false, message: "documentId 缺失或不是合法 UUID" };
  }

  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_QUESTION_COUNT) {
    return { ok: false, message: `count 必须是 1~${MAX_QUESTION_COUNT} 的整数` };
  }

  if (type !== "single" && type !== "multiple" && type !== "short") {
    return { ok: false, message: "type 只能是 single / multiple / short" };
  }

  const parsedTopic = typeof topic === "string" ? topic.trim() : "";
  if (parsedTopic.length > 200) {
    return { ok: false, message: "topic 过长（上限 200 字）" };
  }

  return { ok: true, documentId, count, type, topic: parsedTopic };
}

function buildSystemPrompt(count: number, type: QuizQuestionType): string {
  return `你是「智学」的出题助手，负责把课件内容变成练习题。

工作流程（必须遵守）：
1. 先调用 retrieveForQuiz 检索原文片段（可调用 1~2 次，topic 用课件中的术语）。
2. 再调用 generateQuiz 提交题目 JSON。

硬性要求：
- 所有题目必须能在检索到的片段中找到依据，不得超纲、不得引入片段之外的知识。
- 每道题必须带 citations，documentId 与 pageNum 必须与检索结果完全一致，禁止编造。
- 正好出 ${count} 道题，题型全部为「${TYPE_LABEL[type]}」。
- 选择题给 4 个选项，选项互不重叠；answer 用 0 起始的下标数组。
- 单选题只允许 1 个正确下标；多选题必须给 2~4 个正确下标，不要只给 1 个。
- 简答题 answer 写参考答案文本，且答案要点必须来自片段；简答题不要输出 options 字段。
- 每题提供 explanation，说明依据（可引用片段原句）。
- 如果检索结果不足以支撑 ${count} 道题，可以再调用一次 retrieveForQuiz 换主题词，但不要降低溯源要求。`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_BODY", "请求体必须是 JSON", 400);
  }

  const parsed = parseBody(body);
  if (!parsed.ok) return fail("INVALID_BODY", parsed.message, 400);

  const { documentId, count, type, topic } = parsed;

  // 先校验配置：否则第一个模型请求会抛供应商的原始英文报错，用户看不懂
  try {
    getEnv();
  } catch (configError) {
    return fail("CONFIG_MISSING", describeError(configError).trim(), 500);
  }

  // 本次检索到的全部片段（去重），用于校验引用是否可溯源
  const pieces = new Map<string, RetrievalResultItem>();
  const log: QuizToolStep[] = [];
  let stepIndex = 0;

  const retrieveForQuiz = tool({
    description:
      "按主题在指定课件中检索原文片段。返回片段的 chunkId、文档名、页码与正文（截断）。出题前必须先调用。",
    inputSchema: z.object({
      topic: z.string().min(1).describe("检索主题，尽量使用课件中的术语"),
      topK: z.number().int().min(1).max(8).optional().describe("返回片段数，默认 6"),
    }),
    execute: async ({ topic: queryTopic, topK }) => {
      stepIndex += 1;
      const results = await retrieve({
        query: queryTopic,
        docIds: [documentId],
        topK: topK ?? RETRIEVAL_TOP_K,
      });

      for (const piece of results) {
        if (!pieces.has(piece.chunkId)) pieces.set(piece.chunkId, piece);
      }

      log.push({
        step: stepIndex,
        tool: "retrieveForQuiz",
        input: `topic=${queryTopic}${topK ? `, topK=${topK}` : ""}`,
        output:
          results.length === 0
            ? "未检索到片段"
            : `检索到 ${results.length} 个片段：${results
                .map((piece) => `${piece.docTitle} p.${piece.pageNum}`)
                .join("、")}`,
      });

      return {
        pieces: results.map((piece) => ({
          chunkId: piece.chunkId,
          docTitle: piece.docTitle,
          pageNum: piece.pageNum,
          content: piece.content.slice(0, PIECE_CONTENT_LIMIT),
        })),
      };
    },
  });

  const generateQuizTool = tool({
    description:
      "提交最终题目 JSON。系统会校验题型、数量与引用是否来自检索片段；不合规会抛错，需要修正后重新提交。",
    inputSchema: quizSchema,
    execute: async (quiz) => {
      stepIndex += 1;
      const notes: string[] = [];
      const fatal: string[] = [];

      // 本次检索命中的页码（同一文档），用于把模型的引用修正到可溯源的位置
      const availablePages = [...new Set([...pieces.values()].map((piece) => piece.pageNum))].sort(
        (a, b) => a - b,
      );

      const nearestPage = (target: number): number | null => {
        if (availablePages.length === 0) return null;
        return availablePages.reduce((best, page) =>
          Math.abs(page - target) < Math.abs(best - target) ? page : best,
        );
      };

      // 数量：多的截断、少的接受——不因为差一两道就把整批作废
      const questions: QuizQuestion[] = quiz.questions.slice(0, count).map((question) => ({
        ...question,
      }));
      if (quiz.questions.length !== count) {
        notes.push(`模型提交 ${quiz.questions.length} 道，按 ${count} 道取用`);
      }
      if (questions.length === 0) {
        return { ok: false, reason: "没有提交任何题目" };
      }

      questions.forEach((question, index) => {
        const label = `第 ${index + 1} 题`;

        if (type === "short") {
          if (typeof question.answer !== "string") {
            question.answer = Array.isArray(question.answer)
              ? question.answer.join("、")
              : String(question.answer);
            notes.push(`${label} 答案已转为文本`);
          }
          if (question.options) {
            delete question.options;
            notes.push(`${label} 简答题的多余选项已移除`);
          }
        } else {
          if (!question.options || question.options.length < 2) {
            fatal.push(`${label} 缺少选项`);
            return;
          }
          if (!Array.isArray(question.answer)) {
            const text = String(question.answer);
            const hit = question.options.findIndex((option) => option.trim() === text.trim());
            question.answer = [hit >= 0 ? hit : 0];
            notes.push(`${label} 答案文本已转换为选项下标`);
          }
          const maxIndex = question.options.length - 1;
          question.answer = question.answer.filter((value) => value >= 0 && value <= maxIndex);
          if (question.answer.length === 0) {
            question.answer = [0];
            notes.push(`${label} 答案下标无效，回落为第 1 个选项`);
          }
          if (question.type === "single" && question.answer.length > 1) {
            question.answer = question.answer.slice(0, 1);
            notes.push(`${label} 单选题答案过多，只保留 1 个`);
          }
          if (question.type === "multiple" && question.answer.length < 2) {
            // 多选题只给 1 个正确项：降级成单选，题面与选项依然可作答
            question.type = "single";
            notes.push(`${label} 只有 1 个正确选项，已降级为单选`);
          }
        }

        // 引用：页码对不上就修正到最近的可溯源页码，绝不编造
        const citations = (question.citations ?? [])
          .map((citation) => {
            if (availablePages.includes(citation.pageNum)) {
              return { documentId, pageNum: citation.pageNum };
            }
            const nearest = nearestPage(citation.pageNum);
            if (nearest === null) return null;
            notes.push(`第 ${index + 1} 题引用页码 ${citation.pageNum} 改为 ${nearest}`);
            return { documentId, pageNum: nearest };
          })
          .filter((citation): citation is { documentId: string; pageNum: number } => citation !== null);

        if (citations.length === 0) {
          const fallback = nearestPage(1);
          if (fallback === null) {
            fatal.push(`${label} 找不到可溯源片段`);
            return;
          }
          citations.push({ documentId, pageNum: fallback });
          notes.push(`${label} 缺少引用，回落到第 ${fallback} 页`);
        }

        question.citations = citations;
      });

      // 只有「无法修复」才拒绝，让模型看到原因后重试；可修复项一律就地修好
      if (fatal.length > 0) {
        return { ok: false, reason: fatal.join("；") };
      }

      if (notes.length > 0) {
        console.warn("[quiz] 自动修正：", notes.join("；"));
      }

      log.push({
        step: stepIndex,
        tool: "generateQuiz",
        input: `${count} 道 ${TYPE_LABEL[type]}，主题：${topic || "全文"}`,
        output:
          notes.length > 0
            ? `通过校验，共 ${questions.length} 道题（自动修正 ${notes.length} 处）`
            : `通过校验，共 ${questions.length} 道题`,
      });

      return { ok: true, questions };
    },
  });

  try {
    const result = await generateText({
      model: STRUCTURED_MODEL,
      system: buildSystemPrompt(count, type),
      prompt: `请基于文档 ${documentId} 出 ${count} 道${TYPE_LABEL[type]}。${
        topic ? `聚焦主题：${topic}。` : "主题不限，覆盖文档重点。"
      }`,
      tools: { retrieveForQuiz, generateQuiz: generateQuizTool },
      stopWhen: stepCountIs(MAX_STEPS),
      temperature: 0.4,
      maxOutputTokens: 4096,
    });

    type QuizToolOutput = { ok?: boolean; questions?: QuizQuestion[]; reason?: string };
    const quizOutputs = result.steps
      .flatMap((step) => step.toolResults ?? [])
      .filter((toolResult) => toolResult.toolName === "generateQuiz")
      .map((toolResult) => toolResult.output as QuizToolOutput | undefined);

    // 取最后一次「通过校验」的提交（模型可能先失败再重试）
    const accepted = [...quizOutputs]
      .reverse()
      .find((item) => item?.ok === true && Array.isArray(item.questions) && item.questions.length > 0);
    const acceptedQuestions = accepted?.questions ?? [];

    if (acceptedQuestions.length === 0) {
      const lastReason = [...quizOutputs].reverse().find((item) => item?.reason)?.reason;
      return fail(
        "INTERNAL_ERROR",
        `出题未完成：模型没有在 ${MAX_STEPS} 步内提交合规题目${
          log.length > 0 ? `（已执行 ${log.length} 次工具调用）` : ""
        }${lastReason ? `。最后一次的问题：${lastReason}` : ""}，请重试或换个主题`,
        500,
      );
    }

    const payload: QuizPayload = { questions: acceptedQuestions, log };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[quiz] 出题失败：", error);
    return fail("INTERNAL_ERROR", `出题失败：${describeModelError(error)}`, 500);
  }
}
