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

/** 页面四周留白（对应外层 p-3）与最大渲染宽度 */
const CONTAINER_PADDING = 28;
const MAX_PAGE_WIDTH = 860;
const MIN_PAGE_WIDTH = 280;

/** 宽度变化小于该阈值时不重排，避免滚动条出现/消失导致的来回抖动 */
const WIDTH_HYSTERESIS = 8;

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
  /** 0 表示尚未测量，测量完成前不渲染页面，避免「先 520 再跳到实际宽度」的跳变 */
  const [width, setWidth] = useState(0);
  /** 手动翻页后的页码；为 null 时跟随 props（点击引用时复位） */
  const [manualPage, setManualPage] = useState<number | null>(null);

  const measureRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  /** 已执行过自动滚动的目标标识，防止重复滚动 */
  const scrolledKeyRef = useRef("");

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

  // 宽度自适应：
  // 只观察「不滚动的外层」，滚动发生在其子元素里，因此纵向滚动条的出现不会改变被观察元素的宽度，
  // 从根上断开「渲染 → 出滚动条 → 宽度变小 → 重渲染」的循环。
  useEffect(() => {
    const element = measureRef.current;
    if (!element) return;

    const apply = (raw: number) => {
      const next = Math.floor(Math.min(Math.max(raw - CONTAINER_PADDING, MIN_PAGE_WIDTH), MAX_PAGE_WIDTH));
      setWidth((previous) => (Math.abs(previous - next) >= WIDTH_HYSTERESIS ? next : previous));
    };

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) apply(rect.width);
    });
    observer.observe(element);

    // 首帧立即量一次，避免初始为空
    apply(element.getBoundingClientRect().width);

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

  const displayPage = manualPage ?? pageNumber;
  const canGoPrev = displayPage > 1;
  const canGoNext = numPages > 0 && displayPage < numPages;

  /**
   * 文本层渲染完成后滚动到高亮处。
   * 同一个「文档 + 页码 + 片段」只滚一次：宽度变化会重复触发该回调，
   * 若每次都滚，就会出现页面自己上下来回跳的现象。
   */
  const handleTextLayerRendered = useCallback(() => {
    const key = `${documentId ?? ""}|${displayPage}|${snippet ?? ""}`;
    if (scrolledKeyRef.current === key) return;
    scrolledKeyRef.current = key;

    const mark = pageRef.current?.querySelector("mark");
    if (mark) {
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [documentId, displayPage, snippet]);

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

      {/* 外层只负责测量，自身不滚动；滚动条出现在内层，不会反过来影响测量结果 */}
      <div ref={measureRef} className="min-h-0 flex-1 p-3">
        <div className="h-full overflow-y-auto overflow-x-hidden">
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

          {documentId && !error && (!url || width === 0) && (
            <div className="mx-auto w-full max-w-xl space-y-2 p-4" aria-busy="true">
              <div className="h-4 w-24 animate-pulse rounded bg-neutral-200" />
              <div className="h-[60vh] w-full animate-pulse rounded-lg bg-neutral-200/70" />
            </div>
          )}

          {documentId && !error && url && width > 0 && (
            <Document
              file={url}
              onLoadSuccess={({ numPages: total }) => setNumPages(total)}
              onLoadError={(loadError) => setError(loadError.message)}
              loading={
                <div className="w-full p-4" aria-busy="true">
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
    </div>
  );
}
