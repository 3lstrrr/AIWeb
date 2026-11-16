// 出题 Agent：generateText + 两个工具（retrieveForQuiz 检索、generateQuiz 提交题目）。
// 两道工具形成 agent 循环：先检索 → 再按片段出题；模型提交的题目会校验题型/数量/引用是否可溯源，
// 不合规直接抛错让它自我修正（受 stepCountIs 限制，不会无限重试）。

import { NextResponse } from "next/server";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { buildApiError } from "@/lib/api-error";
import { getEnv } from "@/lib/env";
import { CHAT_MODEL } from "@/lib/llm";
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

/** Agent 最大步数：检索 + 提交（允许一次纠错） */
const MAX_STEPS = 4;

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
- 选择题给 4 个选项，选项互不重叠；answer 用 0 起始的下标数组（单选题只允许 1 个下标，多选题至少 2 个）。
- 简答题 answer 写参考答案文本，且答案要点必须来自片段。
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
      const problems: string[] = [];

      if (quiz.questions.length !== count) {
        problems.push(`题目数量必须是 ${count} 道，当前 ${quiz.questions.length} 道`);
      }

      quiz.questions.forEach((question, index) => {
        const label = `第 ${index + 1} 题`;
        if (question.type !== type) {
          problems.push(`${label} 题型必须是 ${type}`);
        }
        if (question.type === "short") {
          if (typeof question.answer !== "string") problems.push(`${label} 简答题 answer 必须是文本`);
        } else {
          if (!Array.isArray(question.answer)) problems.push(`${label} 选择题 answer 必须是下标数组`);
          if (!question.options || question.options.length < 2) problems.push(`${label} 缺少选项`);
          if (Array.isArray(question.answer)) {
            const maxIndex = (question.options?.length ?? 0) - 1;
            if (question.answer.some((value) => value < 0 || value > maxIndex)) {
              problems.push(`${label} answer 下标越界`);
            }
            if (question.type === "single" && question.answer.length !== 1) {
              problems.push(`${label} 单选题只能有 1 个正确选项`);
            }
            if (question.type === "multiple" && question.answer.length < 2) {
              problems.push(`${label} 多选题至少 2 个正确选项`);
            }
          }
        }

        for (const citation of question.citations) {
          const matched = [...pieces.values()].some(
            (piece) => piece.documentId === citation.documentId && piece.pageNum === citation.pageNum,
          );
          if (!matched) {
            problems.push(
              `${label} 的引用（${citation.documentId} 第 ${citation.pageNum} 页）不在检索片段中`,
            );
          }
        }
      });

      if (problems.length > 0) {
        // 抛错 → 模型看到错误信息后自我修正（受 MAX_STEPS 限制）
        throw new Error(`出题不合规，请修正后重新调用 generateQuiz：\n- ${problems.join("\n- ")}`);
      }

      log.push({
        step: stepIndex,
        tool: "generateQuiz",
        input: `${count} 道 ${TYPE_LABEL[type]}，主题：${topic || "全文"}`,
        output: `通过校验，共 ${quiz.questions.length} 道题`,
      });

      return { questions: quiz.questions };
    },
  });

  try {
    const result = await generateText({
      model: CHAT_MODEL,
      system: buildSystemPrompt(count, type),
      prompt: `请基于文档 ${documentId} 出 ${count} 道${TYPE_LABEL[type]}。${
        topic ? `聚焦主题：${topic}。` : "主题不限，覆盖文档重点。"
      }`,
      tools: { retrieveForQuiz, generateQuiz: generateQuizTool },
      stopWhen: stepCountIs(MAX_STEPS),
      temperature: 0.4,
      maxOutputTokens: 4096,
    });

    const quizOutput = result.steps
      .flatMap((step) => step.toolResults ?? [])
      .filter((toolResult) => toolResult.toolName === "generateQuiz")
      .at(-1)?.output as { questions: QuizQuestion[] } | undefined;

    if (!quizOutput || !Array.isArray(quizOutput.questions)) {
      return fail(
        "INTERNAL_ERROR",
        `出题未完成：模型没有在 ${MAX_STEPS} 步内提交合规题目${
          log.length > 0 ? `（已执行 ${log.length} 次工具调用）` : ""
        }，请重试或换个主题`,
        500,
      );
    }

    const payload: QuizPayload = { questions: quizOutput.questions, log };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[quiz] 出题失败：", error);
    return fail("INTERNAL_ERROR", `出题失败：${describeError(error)}`, 500);
  }
}
