"use client";

// 检索质量调试页：输入问题 → 调 /api/retrieve → 表格展示 Top-4 片段（文档名 / 页码 / 摘要 / 分数）。
// 非面向用户，仅用于肉眼判断「向量召回 + 精排」的效果，分数按区间着色；失败统一 toast。

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeError, readApiError } from "@/lib/api-error";
import type { RetrievalResultItem } from "@/types";

/** 摘要截断长度 */
const SUMMARY_LENGTH = 120;

interface ScoreTone {
  className: string;
  label: string;
}

/** 分数着色：高=绿，中=黄，低=灰 */
function toneOf(score: number): ScoreTone {
  if (score >= 0.7) {
    return { className: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "高" };
  }
  if (score >= 0.4) {
    return { className: "border-amber-200 bg-amber-50 text-amber-700", label: "中" };
  }
  return { className: "border-neutral-200 bg-neutral-50 text-neutral-500", label: "低" };
}

export default function DebugPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<RetrievalResultItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [searched, setSearched] = useState(false);

  const degraded = items.some((item) => !item.reranked);

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    const startedAt = performance.now();

    try {
      const response = await fetch("/api/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const message = readApiError(payload, `请求失败（HTTP ${response.status}）`);
        setItems([]);
        setElapsed(null);
        setError(message);
        toast.error(message);
      } else {
        setItems(payload as RetrievalResultItem[]);
        setElapsed(Math.round(performance.now() - startedAt));
      }
    } catch (err) {
      const message = describeError(err);
      setItems([]);
      setElapsed(null);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 pl-12 md:pl-6">
      <header className="mb-8 space-y-3 border-b border-neutral-200 pb-6">
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
          检索质量调试页 · 非面向用户
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">检索调试</h1>
        <p className="text-sm leading-relaxed text-neutral-600">
          链路：问题向量化（embedding-3，1024 维）→ 向量召回 Top-8（pgvector 余弦）→
          bge-reranker-large 精排取 Top-4。精排失败时自动降级为纯向量检索，此时分数为向量相似度。
        </p>
      </header>

      <form onSubmit={runSearch} className="mb-6 flex flex-col gap-3 sm:flex-row">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入一个能在这份 PDF 里找到答案的问题…"
          className="h-10 flex-1"
          maxLength={500}
        />
        <Button type="submit" disabled={loading || query.trim().length === 0} className="h-10 px-6">
          {loading ? "检索中…" : "检索"}
        </Button>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 异步区块：检索期间的骨架占位 */}
      {loading && (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-neutral-100" />
              <div className="h-4 w-32 shrink-0 animate-pulse rounded bg-neutral-100" />
              <div className="h-4 flex-1 animate-pulse rounded bg-neutral-100" />
              <div className="h-4 w-16 shrink-0 animate-pulse rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
          <span>命中 {items.length} 条</span>
          {elapsed !== null && <span>耗时 {elapsed} ms</span>}
          {degraded ? (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
              精排降级 · 分数为向量相似度
            </Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
              已精排
            </Badge>
          )}
          <span className="text-neutral-400">≥0.70 高 · 0.40–0.69 中 · &lt;0.40 低</span>
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="w-12 px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">文档</th>
                <th className="w-16 px-4 py-3 font-medium">页码</th>
                <th className="px-4 py-3 font-medium">内容摘要（前 {SUMMARY_LENGTH} 字）</th>
                <th className="w-32 px-4 py-3 font-medium">分数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((item, index) => {
                const tone = toneOf(item.score);
                return (
                  <tr key={item.chunkId} className="align-top">
                    <td className="px-4 py-3 text-neutral-400">{index + 1}</td>
                    <td className="px-4 py-3 text-neutral-800">
                      <span className="line-clamp-2 max-w-[180px]" title={item.docTitle}>
                        {item.docTitle}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">p.{item.pageNum}</td>
                    <td className="px-4 py-3 leading-relaxed text-neutral-700">
                      {item.content.slice(0, SUMMARY_LENGTH)}
                      {item.content.length > SUMMARY_LENGTH ? "…" : ""}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={tone.className}>
                          {tone.label}
                        </Badge>
                        <span className="font-mono text-xs text-neutral-700">
                          {item.score.toFixed(3)}
                        </span>
                      </div>
                      <span className="mt-1 block font-mono text-[11px] text-neutral-400">
                        向量 {item.vectorScore.toFixed(3)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {searched && !loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center text-sm text-neutral-500">
          没有命中任何片段。请确认：文档已上传 → 已调用 /api/embed 完成向量化 → 换一个更贴近原文的问题。
        </div>
      )}
    </main>
  );
}
