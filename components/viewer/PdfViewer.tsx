"use client";

// PDF 原文查看器：按 signed URL 加载文档，支持跳页 + 页内文本高亮。
// 必须由调用方用 next/dynamic({ ssr: false }) 引入：pdf.js 依赖 window/document，SSR 会直接报错。
// worker 由 public/pdf.worker.min.mjs 提供（拷自 node_modules/pdfjs-dist/build/pdf.worker.min.mjs），
// 升级 pdfjs-dist 后需要重新复制该文件。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { toast } from "sonner";
import { describeError } from "@/lib/api-error";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

/** 逐级缩短的匹配键：pdf.js 的文本片段往往被切成半句话，长键更容易匹配失败 */
const HIGHLIGHT_KEY_LENGTHS = [24, 16, 12, 8, 6];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

interface PdfViewerProps {
  documentId: string | null;
  /** 目标页码（1 起） */
  pageNumber: number;
  /** 要高亮的片段；匹配不到时只跳页 */
  snippet?: string;
}

export default function PdfViewer({ documentId, pageNumber, snippet }: PdfViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(520);
  /** 手动翻页后的页码；为 null 时跟随 props（点击引用时复位） */
  const [manualPage, setManualPage] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  // 点击新的引用或切换文档时，回到 props 指定的页码
  useEffect(() => {
    setManualPage(null);
  }, [documentId, pageNumber, snippet]);

  // 取 signed URL
  useEffect(() => {
    if (!documentId) {
      setUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setUrl(null);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/url`);
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message =
            typeof payload === "object" && payload !== null && "error" in payload
              ? String((payload as { error: { message?: string } }).error?.message ?? "")
              : "";
          const reason = message || `获取原文地址失败（HTTP ${response.status}）`;
          if (!cancelled) {
            setError(reason);
            toast.error(reason);
          }
          return;
        }
        const data = payload as { url: string };
        if (!cancelled) setUrl(data.url);
      } catch (fetchError) {
        if (!cancelled) {
          const reason = describeError(fetchError);
          setError(reason);
          toast.error(reason);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // 容器宽度自适应
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0;
      if (nextWidth > 0) setWidth(Math.floor(Math.min(nextWidth - 24, 860)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** 从长到短生成匹配键（去空白，避免 PDF 换行导致的空格差异） */
  const highlightKeys = useMemo(() => {
    if (!snippet) return [] as string[];
    const cleaned = snippet.replace(/\s+/g, " ").trim();
    if (!cleaned) return [];
    const keys = HIGHLIGHT_KEY_LENGTHS.filter((length) => cleaned.length >= length).map((length) =>
      cleaned.slice(0, length),
    );
    return [...new Set(keys)].sort((a, b) => b.length - a.length);
  }, [snippet]);

  /** pdf.js 逐片段回调：命中则包一层 <mark>，否则原样返回（需转义） */
  const renderTextItem = useCallback(
    ({ str }: { str: string }) => {
      if (!str || highlightKeys.length === 0) return escapeHtml(str);

      for (const key of highlightKeys) {
        const index = str.indexOf(key);
        if (index === -1) continue;
        const before = escapeHtml(str.slice(0, index));
        const hit = escapeHtml(str.slice(index, index + key.length));
        const after = escapeHtml(str.slice(index + key.length));
        return `${before}<mark class="rounded-sm bg-yellow-200 px-0.5 text-neutral-900">${hit}</mark>${after}`;
      }

      return escapeHtml(str);
    },
    [highlightKeys],
  );

  /** 文本层渲染完成后，把第一个高亮滚到视口中间 */
  const handleTextLayerRendered = useCallback(() => {
    const mark = pageRef.current?.querySelector("mark");
    mark?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const displayPage = manualPage ?? pageNumber;
  const canGoPrev = displayPage > 1;
  const canGoNext = numPages > 0 && displayPage < numPages;

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-100">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-3 py-2">
        <p className="truncate text-xs text-neutral-500">
          {documentId ? `第 ${displayPage}${numPages > 0 ? ` / ${numPages}` : ""} 页` : "原文预览"}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setManualPage(Math.max(1, displayPage - 1))}
            disabled={!canGoPrev}
            className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-40"
          >
            上一页
          </button>
          <button
            type="button"
            onClick={() => setManualPage(Math.min(numPages || displayPage + 1, displayPage + 1))}
            disabled={!canGoNext}
            className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-40"
          >
            下一页
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="ml-1 rounded-md px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
            >
              原文件
            </a>
          )}
        </div>
      </header>

      <div ref={containerRef} className="flex-1 overflow-auto p-3">
        {!documentId && (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs leading-relaxed text-neutral-400">
            点击回答中的引用角标或来源卡片，
            <br />
            这里会跳到原文对应页并高亮片段。
          </div>
        )}

        {documentId && error && (
          <div className="mx-auto max-w-sm rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            原文加载失败：{error}
          </div>
        )}

        {documentId && !error && !url && (
          <div className="mx-auto w-full max-w-xl space-y-2 p-4" aria-busy="true">
            <div className="h-4 w-24 animate-pulse rounded bg-neutral-200" />
            <div className="h-[60vh] w-full animate-pulse rounded-lg bg-neutral-200/70" />
          </div>
        )}

        {documentId && !error && url && (
          <Document
            file={url}
            onLoadSuccess={({ numPages: total }) => setNumPages(total)}
            onLoadError={(loadError) => setError(loadError.message)}
            loading={
              <div className="w-full max-w-xl p-4" aria-busy="true">
                <div className="h-[70vh] w-full animate-pulse rounded-lg bg-neutral-200/70" />
              </div>
            }
            error={<div className="p-6 text-center text-xs text-red-600">PDF 打开失败</div>}
            className="flex flex-col items-center"
          >
            <div ref={pageRef} className="mb-3 shadow-sm">
              <Page
                pageNumber={Math.min(displayPage, numPages || displayPage)}
                width={width}
                customTextRenderer={renderTextItem}
                onRenderTextLayerSuccess={handleTextLayerRendered}
                renderAnnotationLayer={false}
                loading={
                  <div
                    className="animate-pulse rounded bg-neutral-200/70"
                    style={{ width, height: Math.round(width * 1.35) }}
                  />
                }
              />
            </div>
          </Document>
        )}
      </div>
    </div>
  );
}
