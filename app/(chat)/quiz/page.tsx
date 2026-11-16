"use client";

// AI 出题页：选文档 + 数量/题型/主题 → /api/quiz 出题 → 展示工具调用日志 → 逐题作答并即时判分。

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { describeError, readApiError } from "@/lib/api-error";
import { useDocsStore } from "@/stores/docs";
import { formatCitation, isAnswerCorrect, useQuizStore } from "@/stores/quiz";
import type { DocumentSummary, QuizPayload, QuizQuestionType } from "@/types";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

const TYPE_OPTIONS: ReadonlyArray<{ value: QuizQuestionType; label: string }> = [
  { value: "single", label: "单选题" },
  { value: "multiple", label: "多选题" },
  { value: "short", label: "简答题" },
];

const TOOL_LABEL: Record<string, string> = {
  retrieveForQuiz: "检索原文",
  generateQuiz: "提交题目",
};

export default function QuizPage() {
  const documentId = useQuizStore((state) => state.documentId);
  const count = useQuizStore((state) => state.count);
  const type = useQuizStore((state) => state.type);
  const topic = useQuizStore((state) => state.topic);
  const status = useQuizStore((state) => state.status);
  const error = useQuizStore((state) => state.error);
  const questions = useQuizStore((state) => state.questions);
  const log = useQuizStore((state) => state.log);
  const answers = useQuizStore((state) => state.answers);
  const shortAnswers = useQuizStore((state) => state.shortAnswers);
  const submitted = useQuizStore((state) => state.submitted);

  const setForm = useQuizStore((state) => state.setForm);
  const startLoading = useQuizStore((state) => state.startLoading);
  const setResult = useQuizStore((state) => state.setResult);
  const setStoreError = useQuizStore((state) => state.setError);
  const toggleOption = useQuizStore((state) => state.toggleOption);
  const setShortAnswer = useQuizStore((state) => state.setShortAnswer);
  const submitAnswers = useQuizStore((state) => state.submitAnswers);
  const resetResult = useQuizStore((state) => state.resetResult);

  const documents = useDocsStore((state) => state.documents);
  const setDocuments = useDocsStore((state) => state.setDocuments);
  const [loadingDocs, setLoadingDocs] = useState(true);

  // 文档下拉数据源
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/documents", { cache: "no-store" });
        const payload: unknown = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          toast.error(readApiError(payload, "文档列表加载失败"));
          return;
        }
        setDocuments((payload as { documents: DocumentSummary[] }).documents);
      } catch (fetchError) {
        if (!cancelled) toast.error(describeError(fetchError));
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setDocuments]);

  const titleById = useMemo(
    () => new Map(documents.map((document) => [document.id, document.title])),
    [documents],
  );

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const state = useQuizStore.getState();

    if (!state.documentId) {
      toast.error("请先选择要出题的文档");
      return;
    }

    startLoading();
    try {
      const response = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: state.documentId,
          count: state.count,
          type: state.type,
          topic: state.topic.trim(),
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const message = readApiError(payload, "出题失败，请稍后重试");
        setStoreError(message);
        toast.error(message);
        return;
      }

      setResult(payload as QuizPayload);
      toast.success("题目已生成");
    } catch (generateError) {
      const message = describeError(generateError);
      setStoreError(message);
      toast.error(message);
    }
  };

  const totalAnswered = questions.filter((_, index) =>
    questions[index].type === "short"
      ? (shortAnswers[index] ?? "").trim().length > 0
      : (answers[index] ?? []).length > 0,
  ).length;

  const correctCount = submitted
    ? questions.filter((question, index) =>
        isAnswerCorrect(question, answers[index] ?? [], shortAnswers[index] ?? ""),
      ).length
    : 0;

  return (
    <main className="h-full overflow-y-auto bg-neutral-50">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 pl-12 md:px-6 md:pl-6">
        <header className="mb-6 space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">AI 出题</h1>
          <p className="text-sm text-neutral-500">
            Agent 会先检索课件原文，再基于片段出题；每道题都带原文引用，确保可追溯、不超纲。
          </p>
        </header>

        {/* 表单 */}
        <form
          onSubmit={handleGenerate}
          className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-neutral-200 bg-white p-4 md:grid-cols-12"
        >
          <label className="md:col-span-5">
            <span className="mb-1 block text-xs text-neutral-500">文档</span>
            <select
              value={documentId}
              onChange={(event) => setForm({ documentId: event.target.value })}
              disabled={loadingDocs || status === "loading"}
              className="w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-sm text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50"
            >
              <option value="">{loadingDocs ? "加载中…" : "请选择文档"}</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>

          <label className="md:col-span-2">
            <span className="mb-1 block text-xs text-neutral-500">数量</span>
            <input
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(event) => setForm({ count: Number(event.target.value) || 1 })}
              disabled={status === "loading"}
              className="w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-sm outline-none focus:border-neutral-400 disabled:opacity-50"
            />
          </label>

          <label className="md:col-span-2">
            <span className="mb-1 block text-xs text-neutral-500">题型</span>
            <select
              value={type}
              onChange={(event) => setForm({ type: event.target.value as QuizQuestionType })}
              disabled={status === "loading"}
              className="w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-sm text-neutral-800 outline-none focus:border-neutral-400 disabled:opacity-50"
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="md:col-span-3">
            <span className="mb-1 block text-xs text-neutral-500">主题（可留空）</span>
            <input
              value={topic}
              onChange={(event) => setForm({ topic: event.target.value })}
              maxLength={200}
              placeholder="如：梯度下降"
              disabled={status === "loading"}
              className="w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:opacity-50"
            />
          </label>

          <div className="flex items-center gap-2 md:col-span-12">
            <button
              type="submit"
              disabled={status === "loading" || !documentId}
              className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
            >
              {status === "loading" ? "Agent 出题中…" : "开始出题"}
            </button>
            {questions.length > 0 && (
              <button
                type="button"
                onClick={resetResult}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100"
              >
                重新出题
              </button>
            )}
            {status === "loading" && (
              <span className="text-xs text-neutral-400">检索 + 出题通常需要 10~30 秒</span>
            )}
          </div>
        </form>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* 生成中骨架 */}
        {status === "loading" && (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-24 animate-pulse rounded-xl bg-neutral-100" />
            ))}
          </div>
        )}

        {/* 思考日志 */}
        {log.length > 0 && (
          <details className="mb-4 rounded-xl border border-neutral-200 bg-white" open>
            <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-neutral-600">
              思考日志 · {log.length} 次工具调用
            </summary>
            <ol className="space-y-2 border-t border-neutral-100 px-4 py-3">
              {log.map((step, index) => (
                <li key={`${step.step}-${index}`} className="text-xs leading-relaxed">
                  <span className="font-mono text-[11px] text-neutral-400">
                    #{step.step}
                  </span>{" "}
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-700">
                    {TOOL_LABEL[step.tool] ?? step.tool}
                  </span>{" "}
                  <span className="text-neutral-500">{step.input}</span>
                  <p className="mt-0.5 text-neutral-600">→ {step.output}</p>
                </li>
              ))}
            </ol>
          </details>
        )}

        {/* 题目列表 */}
        {questions.length > 0 && (
          <section className="space-y-3">
            {questions.map((question, index) => {
              const selected = answers[index] ?? [];
              const shortText = shortAnswers[index] ?? "";
              const correct = submitted
                ? isAnswerCorrect(question, selected, shortText)
                : false;
              const expected = Array.isArray(question.answer) ? question.answer : [];

              return (
                <article
                  key={index}
                  className="rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-relaxed text-neutral-900">
                      {index + 1}. {question.stem}
                    </p>
                    {submitted && (
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
                          correct
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-red-200 bg-red-50 text-red-700"
                        }`}
                      >
                        {correct ? "回答正确" : "回答错误"}
                      </span>
                    )}
                  </div>

                  {question.type === "short" ? (
                    <textarea
                      value={shortText}
                      onChange={(event) => setShortAnswer(index, event.target.value)}
                      disabled={submitted}
                      rows={3}
                      placeholder="写下你的答案…"
                      className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:bg-neutral-50"
                    />
                  ) : (
                    <ul className="space-y-1.5">
                      {(question.options ?? []).map((option, optionIndex) => {
                        const checked = selected.includes(optionIndex);
                        return (
                          <li key={optionIndex}>
                            <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-50">
                              <input
                                type={question.type === "multiple" ? "checkbox" : "radio"}
                                name={`q-${index}`}
                                checked={checked}
                                disabled={submitted}
                                onChange={() =>
                                  toggleOption(index, optionIndex, question.type === "multiple")
                                }
                                className="mt-0.5"
                              />
                              <span>
                                <span className="mr-1.5 font-mono text-xs text-neutral-400">
                                  {LETTERS[optionIndex]}
                                </span>
                                {option}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {submitted && (
                    <div className="mt-3 space-y-2 rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-700">
                      <p>
                        <span className="font-medium text-neutral-900">正确答案：</span>
                        {question.type === "short"
                          ? String(question.answer)
                          : expected
                              .map((value) => `${LETTERS[value]}. ${question.options?.[value] ?? ""}`)
                              .join("；")}
                      </p>
                      <p>
                        <span className="font-medium text-neutral-900">解析：</span>
                        {question.explanation}
                      </p>
                      {question.citations.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {question.citations.map((citation, citationIndex) => (
                            <span
                              key={`${citation.documentId}-${citation.pageNum}-${citationIndex}`}
                              className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
                            >
                              {formatCitation(citation, titleById)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}

            <div className="flex items-center gap-3 pt-1">
              {!submitted ? (
                <button
                  type="button"
                  onClick={() => {
                    if (totalAnswered === 0) {
                      toast.error("至少作答一题再提交");
                      return;
                    }
                    submitAnswers();
                  }}
                  className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
                >
                  提交作答（已答 {totalAnswered}/{questions.length}）
                </button>
              ) : (
                <p className="text-sm text-neutral-700">
                  得分：
                  <span className="mx-1 font-semibold text-neutral-900">
                    {correctCount}/{questions.length}
                  </span>
                  {correctCount === questions.length && " · 全对，漂亮！"}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
