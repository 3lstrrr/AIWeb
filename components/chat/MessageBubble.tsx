"use client";

// 单条消息气泡：用户靠右深色（纯文本），AI 靠左浅色（Markdown + 引用角标 + 来源卡片）。

import dynamic from "next/dynamic";
import CitationCard from "@/components/chat/CitationCard";
import type { Citation, MessageRole } from "@/types";

/**
 * markdown 渲染栈（react-markdown + remark-gfm + rehype-highlight/lowlight）约 96 kB，
 * 单独分包按需加载：首屏只有空状态，不会渲染它，因此不会计入首屏 JS。
 * 不设 ssr:false —— 聊天页初始无消息，服务端根本不会渲染它，因此也不存在占位闪烁。
 */
const MarkdownContent = dynamic(() => import("@/components/chat/MarkdownContent"));

interface MessageBubbleProps {
  role: MessageRole;
  content: string;
  /** 该条消息正在流式输出 */
  streaming?: boolean;
  /** 本条消息可用的引用片段（角标编号对应其 index） */
  citations?: Citation[];
  /** 点击角标或来源卡片 */
  onCitationClick?: (citation: Citation) => void;
}

export default function MessageBubble({
  role,
  content,
  streaming = false,
  citations = [],
  onCitationClick,
}: MessageBubbleProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-neutral-900 px-4 py-2.5 text-sm leading-relaxed text-white">
          {content}
        </div>
      </div>
    );
  }

  // 首个 token 到达前内容为空，交给 ThinkingIndicator 展示，避免出现空气泡
  if (content.length === 0) return null;

  const handleBadgeClick = (index: number) => {
    const target = citations.find((citation) => citation.index === index);
    // 编号越界（模型编造）时静默忽略，不做跳转
    if (target) onCitationClick?.(target);
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] break-words rounded-2xl rounded-bl-sm border border-neutral-200 bg-white px-4 py-2.5 shadow-sm">
        <MarkdownContent content={content} streaming={streaming} onCitationClick={handleBadgeClick} />
        {streaming && (
          <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse rounded-full bg-neutral-400 align-middle" />
        )}

        {/* 流式结束后再出卡片，避免生成过程中列表反复跳动 */}
        {!streaming && citations.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-neutral-100 pt-2">
            <p className="text-[11px] text-neutral-400">引用来源 · 点击定位原文</p>
            {citations.map((citation) => (
              <CitationCard
                key={`${citation.index}-${citation.document_id}-${citation.page_num}`}
                citation={citation}
                onClick={onCitationClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
