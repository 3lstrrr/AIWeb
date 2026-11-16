"use client";

// 工作台布局：桌面端左右分栏（可拖拽分割线），移动端上下堆叠且查看器可折叠；
// 左侧聊天，右侧 PDF 原文定位。点击引用时在移动端自动展开查看器。

import dynamic from "next/dynamic";
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ChatWindow from "@/components/chat/ChatWindow";
import type { Citation } from "@/types";

// pdf.js 依赖 window/document，必须 ssr:false —— Next.js 里最常见的踩坑点
const PdfViewer = dynamic(() => import("@/components/viewer/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-neutral-400">
      查看器加载中…
    </div>
  ),
});

/** 分割线可拖范围：给聊天气泡留足宽度，同时保证查看器可读 */
const MIN_RATIO = 0.35;
const MAX_RATIO = 0.72;

export default function ChatWorkspace() {
  const [selection, setSelection] = useState<Citation | null>(null);
  const [ratio, setRatio] = useState(0.58);
  const [dragging, setDragging] = useState(false);
  /** 移动端查看器是否展开（桌面端始终展示，此状态不参与布局） */
  const [mobileViewerOpen, setMobileViewerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleCitationClick = useCallback((citation: Citation) => {
    setSelection(citation);
    // 移动端点引用后直接把原文铺开，省去再点一次
    setMobileViewerOpen(true);
  }, []);

  const handleDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    event.preventDefault();
    setDragging(true);

    const total = container.getBoundingClientRect().width;
    const startX = event.clientX;
    const startRatio = ratio;

    const handleMove = (moveEvent: PointerEvent) => {
      if (total <= 0) return;
      const next = startRatio + (moveEvent.clientX - startX) / total;
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
    };
    const handleUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const containerStyle = { "--chat-width": `${Math.round(ratio * 100)}%` } as CSSProperties;

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      className={`flex h-full w-full flex-col overflow-hidden md:flex-row ${
        dragging ? "select-none" : ""
      }`}
    >
      <section className="min-h-0 w-full flex-1 md:h-full md:w-[var(--chat-width)] md:flex-none">
        <ChatWindow onCitationClick={handleCitationClick} />
      </section>

      {/* 移动端：查看器折叠开关（触控高度 44px，符合可点区域建议） */}
      <button
        type="button"
        onClick={() => setMobileViewerOpen((value) => !value)}
        aria-expanded={mobileViewerOpen}
        className="flex min-h-11 w-full touch-manipulation items-center justify-between gap-2 border-t border-neutral-200 bg-white px-4 text-xs font-medium text-neutral-600 active:bg-neutral-100 md:hidden"
      >
        <span className="truncate">
          {mobileViewerOpen
            ? "收起原文"
            : selection
              ? `查看原文 · 第 ${selection.page_num} 页`
              : "查看原文"}
        </span>
        <span aria-hidden className="text-neutral-400">
          {mobileViewerOpen ? "▾" : "▸"}
        </span>
      </button>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整聊天与原文宽度"
        onPointerDown={handleDividerPointerDown}
        className="hidden w-1.5 shrink-0 cursor-col-resize bg-neutral-200 transition-colors hover:bg-blue-300 md:block"
      />

      <section
        className={`${
          mobileViewerOpen ? "h-[52dvh]" : "hidden"
        } shrink-0 border-t border-neutral-200 md:block md:h-full md:min-h-0 md:flex-1 md:border-l md:border-t-0`}
      >
        <PdfViewer
          documentId={selection?.document_id ?? null}
          pageNumber={selection?.page_num ?? 1}
          snippet={selection?.snippet}
        />
      </section>
    </div>
  );
}
