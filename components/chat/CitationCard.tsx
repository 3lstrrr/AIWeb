"use client";

// 引用来源卡片：文档名 · 页码 · 片段摘要（前 80 字），点击触发原文定位。

import type { Citation } from "@/types";

/** 摘要截断长度 */
const SNIPPET_LENGTH = 80;

interface CitationCardProps {
  citation: Citation;
  onClick?: (citation: Citation) => void;
}

export default function CitationCard({ citation, onClick }: CitationCardProps) {
  const snippet =
    citation.snippet.length > SNIPPET_LENGTH
      ? `${citation.snippet.slice(0, SNIPPET_LENGTH)}…`
      : citation.snippet;

  return (
    <button
      type="button"
      onClick={() => onClick?.(citation)}
      title={`在原文中定位：[${citation.index}] ${citation.doc_title} 第 ${citation.page_num} 页`}
      className="group flex w-full items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50/80 px-2.5 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400"
    >
      <span className="mt-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 px-1 text-[10px] font-medium leading-none text-blue-700 transition-colors group-hover:bg-blue-200">
        {citation.index}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-neutral-700">
          {citation.doc_title}
          <span className="ml-1 font-normal text-neutral-400">· 第 {citation.page_num} 页</span>
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500">{snippet}</span>
      </span>
    </button>
  );
}
