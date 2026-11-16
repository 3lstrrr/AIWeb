// 出题页状态：表单参数、生成状态、题目与思考日志、用户作答与判分提交标记。

import { create } from "zustand";
import type { QuizCitation, QuizPayload, QuizQuestion, QuizQuestionType, QuizToolStep } from "@/types";

export type QuizStatus = "idle" | "loading" | "ready" | "error";

interface QuizForm {
  documentId: string;
  count: number;
  type: QuizQuestionType;
  topic: string;
}

interface QuizState extends QuizForm {
  status: QuizStatus;
  error: string | null;
  questions: QuizQuestion[];
  log: QuizToolStep[];
  /** 选择题作答：题目下标 → 选中的选项下标 */
  answers: Record<number, number[]>;
  /** 简答题作答：题目下标 → 文本 */
  shortAnswers: Record<number, string>;
  submitted: boolean;
  setForm: (patch: Partial<QuizForm>) => void;
  startLoading: () => void;
  setResult: (payload: QuizPayload) => void;
  setError: (message: string) => void;
  toggleOption: (questionIndex: number, optionIndex: number, multiple: boolean) => void;
  setShortAnswer: (questionIndex: number, text: string) => void;
  submitAnswers: () => void;
  resetResult: () => void;
}

export const useQuizStore = create<QuizState>()((set, get) => ({
  documentId: "",
  count: 5,
  type: "single",
  topic: "",
  status: "idle",
  error: null,
  questions: [],
  log: [],
  answers: {},
  shortAnswers: {},
  submitted: false,

  setForm: (patch) => set(patch),

  startLoading: () =>
    set({ status: "loading", error: null, questions: [], log: [], answers: {}, shortAnswers: {}, submitted: false }),

  setResult: (payload) =>
    set({
      status: "ready",
      error: null,
      questions: payload.questions,
      log: payload.log,
      answers: {},
      shortAnswers: {},
      submitted: false,
    }),

  setError: (message) => set({ status: "error", error: message }),

  toggleOption: (questionIndex, optionIndex, multiple) => {
    const current = get().answers[questionIndex] ?? [];
    const next = multiple
      ? current.includes(optionIndex)
        ? current.filter((value) => value !== optionIndex)
        : [...current, optionIndex]
      : [optionIndex];

    set({ answers: { ...get().answers, [questionIndex]: next } });
  },

  setShortAnswer: (questionIndex, text) =>
    set({ shortAnswers: { ...get().shortAnswers, [questionIndex]: text } }),

  submitAnswers: () => set({ submitted: true }),

  resetResult: () =>
    set({
      status: "idle",
      error: null,
      questions: [],
      log: [],
      answers: {},
      shortAnswers: {},
      submitted: false,
    }),
}));

/** 判分：选择题按集合完全一致；简答题按「包含 / 关键词覆盖率」启发式判定 */
export function isAnswerCorrect(
  question: QuizQuestion,
  selected: number[],
  shortText: string,
): boolean {
  if (question.type === "short") {
    const reference = typeof question.answer === "string" ? question.answer : "";
    const normalizedRef = reference.replace(/\s+/g, "");
    const normalizedUser = shortText.replace(/\s+/g, "");
    if (!normalizedUser || !normalizedRef) return false;
    if (normalizedUser.includes(normalizedRef) || normalizedRef.includes(normalizedUser)) return true;

    // 参考答案按 4 字切片，覆盖过半算命中（简单启发式，避免中文分词依赖）
    const grams: string[] = [];
    for (let index = 0; index + 4 <= normalizedRef.length; index += 4) {
      grams.push(normalizedRef.slice(index, index + 4));
    }
    if (grams.length === 0) return false;
    const hit = grams.filter((gram) => normalizedUser.includes(gram)).length;
    return hit / grams.length >= 0.5;
  }

  const answer = Array.isArray(question.answer) ? question.answer : [];
  if (answer.length === 0 || selected.length === 0) return false;
  const expected = [...answer].sort((a, b) => a - b).join(",");
  const actual = [...selected].sort((a, b) => a - b).join(",");
  return expected === actual;
}

/** 引用展示：documentId + pageNum → 可读文案 */
export function formatCitation(citation: QuizCitation, titleById: Map<string, string>): string {
  return `${titleById.get(citation.documentId) ?? "未知文档"} · 第 ${citation.pageNum} 页`;
}
