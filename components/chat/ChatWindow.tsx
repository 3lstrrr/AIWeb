"use client";

// 聊天主窗口：模式切换 + 文档过滤 + 消息列表（底部自动滚动）+ 输入框。
// 发送失败时：草稿回填 + toast 中文提示 + 本地重试（regenerate，不重复插入用户消息）。

import { useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";
import ChatInput from "@/components/chat/ChatInput";
import MessageBubble from "@/components/chat/MessageBubble";
import ModeSwitch from "@/components/chat/ModeSwitch";
import ThinkingIndicator from "@/components/chat/ThinkingIndicator";
import { describeError, readApiError } from "@/lib/api-error";
import { createId } from "@/lib/id";
import { useChatStore } from "@/stores/chat";
import { useDocsStore } from "@/stores/docs";
import type { ChatMessage, Citation, DocumentSummary, MessageRole } from "@/types";

/** /api/conversations/:id/messages 返回的原始消息 */
interface StoredMessage {
  id: string;
  role: MessageRole;
  content: string;
  citations: Citation[] | null;
  created_at: string;
}

/** 取 UIMessage 中的纯文本（parts 里可能混有非文本片段） */
function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** 取最后一条用户消息的文本，作为 /api/chat 的 question */
function lastUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messageText(messages[index]);
  }
  return "";
}

function toChatMessage(message: UIMessage): ChatMessage {
  return { id: message.id, role: message.role, content: messageText(message) };
}

/**
 * 取消息的引用片段（服务端在流开始时通过 messageMetadata 下发），
 * 只保留正文里真正引用到的编号；模型没用角标时（如精确模式拒答）仍展示检索来源。
 */
function citationsOf(message: UIMessage): Citation[] {
  const metadata = message.metadata as { citations?: Citation[] } | undefined;
  const all = metadata?.citations ?? [];
  if (all.length === 0) return [];

  const used = new Set<number>();
  for (const match of messageText(message).matchAll(/\[(\d{1,2})\]/g)) {
    used.add(Number(match[1]));
  }

  const filtered = all.filter((citation) => used.has(citation.index));
  return filtered.length > 0 ? filtered : all;
}

export default function ChatWindow({
  onCitationClick,
}: {
  /** 点击引用角标或来源卡片：由外层工作台接管，用于驱动原文查看器 */
  onCitationClick?: (citation: Citation) => void;
}) {
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const mode = useChatStore((state) => state.mode);
  const draft = useChatStore((state) => state.draft);
  const setDraft = useChatStore((state) => state.setDraft);
  const setCurrentConversationId = useChatStore((state) => state.setCurrentConversationId);
  const setStoreMessages = useChatStore((state) => state.setMessages);
  const setIsStreaming = useChatStore((state) => state.setIsStreaming);
  const setMode = useChatStore((state) => state.setMode);

  const documents = useDocsStore((state) => state.documents);
  const setDocuments = useDocsStore((state) => state.setDocuments);
  const selectedDocumentId = useDocsStore((state) => state.selectedDocumentId);
  const setSelectedDocumentId = useDocsStore((state) => state.setSelectedDocumentId);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // 每次发送时从 store 取最新的会话 / 模式 / 文档过滤条件，避免闭包读到旧值
        prepareSendMessagesRequest: ({ messages: sentMessages }) => {
          const chatState = useChatStore.getState();
          const docsState = useDocsStore.getState();
          return {
            body: {
              conversationId: chatState.currentConversationId,
              question: lastUserText(sentMessages),
              mode: chatState.mode,
              docIds: docsState.selectedDocumentId ? [docsState.selectedDocumentId] : undefined,
            },
          };
        },
      }),
    [],
  );

  const {
    messages,
    sendMessage,
    regenerate,
    status,
    error,
    stop,
    clearError,
    setMessages: setChatMessages,
  } = useChat({
    id: currentConversationId || undefined,
    transport,
  });

  const isStreaming = status === "submitted" || status === "streaming";

  // 历史回填：刷新页面或从侧栏切换会话后，把数据库里的消息与引用读回来
  useEffect(() => {
    if (!currentConversationId) return;

    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/conversations/${currentConversationId}/messages`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          toast.error(readApiError(payload, "历史消息加载失败"));
          return;
        }

        const stored = (payload as { messages?: StoredMessage[] }).messages ?? [];
        if (stored.length === 0) return;

        setChatMessages(
          stored.map((item) => ({
            id: item.id,
            role: item.role,
            parts: [{ type: "text" as const, text: item.content }],
            metadata: { citations: item.citations ?? [] },
          })),
        );
        setStoreMessages(
          stored.map((item) => ({ id: item.id, role: item.role, content: item.content })),
        );
      } catch (loadError) {
        if (cancelled) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        toast.error(describeError(loadError));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentConversationId, setChatMessages, setStoreMessages]);

  // 初始化：恢复持久化的会话 id（没有就新建一个，后端在首次提问时自动落库）
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const applyDefault = () => {
      if (!useChatStore.getState().currentConversationId) {
        setCurrentConversationId(createId());
      }
    };

    void useChatStore.persist.rehydrate();
    if (useChatStore.persist.hasHydrated()) {
      applyDefault();
    } else {
      const unsubscribe = useChatStore.persist.onFinishHydration(() => {
        applyDefault();
        unsubscribe();
      });
    }
  }, [setCurrentConversationId]);

  // 文档过滤下拉的数据源（页面停留期间只拉一次）
  useEffect(() => {
    if (useDocsStore.getState().documents.length > 0) return;

    void (async () => {
      try {
        const response = await fetch("/api/documents", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { documents: DocumentSummary[] };
        setDocuments(payload.documents);
      } catch {
        // 文档列表失败不影响聊天
      }
    })();
  }, [setDocuments]);

  // 同步消息与流式状态到 store
  useEffect(() => {
    setStoreMessages(messages.map(toChatMessage));
  }, [messages, setStoreMessages]);

  useEffect(() => {
    setIsStreaming(isStreaming);
  }, [isStreaming, setIsStreaming]);

  // 请求失败：toast 中文提示 + 把未发出的内容回填到输入框
  useEffect(() => {
    if (!error) return;
    const chatState = useChatStore.getState();
    const lastUser = [...chatState.currentMessages].reverse().find((item) => item.role === "user");
    if (lastUser?.content && !chatState.draft) {
      chatState.setDraft(lastUser.content);
    }
    toast.error(describeError(error));
  }, [error]);

  // 底部自动滚动
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const handleSend = (text: string) => {
    if (!useChatStore.getState().currentConversationId) return;
    clearError();
    setDraft("");
    // sendMessage 一般会把错误写进 error 状态，这里再兜一层，避免未捕获的 Promise 拒绝
    void sendMessage({ text }).catch((sendError: unknown) => {
      toast.error(describeError(sendError));
    });
  };

  // 重试：不重复插入用户消息，直接重跑上一次请求
  const handleRetry = async () => {
    clearError();
    try {
      await regenerate();
    } catch (retryError) {
      toast.error(describeError(retryError));
    }
  };

  const streamingMessageId = status === "streaming" ? messages.at(-1)?.id : undefined;
  const lastMessage = messages.at(-1);
  const lastMessageText = lastMessage ? messageText(lastMessage) : "";
  const showThinking =
    status === "submitted" || (status === "streaming" && lastMessageText.length === 0);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-neutral-50">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3 pl-12 md:pl-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-neutral-900">智学 · AI 课程答疑</h1>
          <p className="truncate text-xs text-neutral-400">
            精确模式只依据课件作答；探索模式会区分「资料依据」与「模型补充」
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={selectedDocumentId}
            onChange={(event) => setSelectedDocumentId(event.target.value)}
            disabled={isStreaming}
            title="限定检索范围"
            className="max-w-[11rem] rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 outline-none focus:border-neutral-400 disabled:opacity-50"
          >
            <option value="">全部文档</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>

          <ModeSwitch value={mode} onChange={setMode} disabled={isStreaming} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && !isStreaming && (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center text-sm text-neutral-500">
              问点什么吧。回答会带上 [1] [2] 角标，点击即可跳转到课件原文对应页。
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={messageText(message)}
              streaming={message.id === streamingMessageId}
              citations={message.role === "assistant" ? citationsOf(message) : []}
              onCitationClick={onCitationClick}
            />
          ))}

          {showThinking && <ThinkingIndicator />}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
              <p className="break-all">{describeError(error)}</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRetry}
                  className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-700"
                >
                  重试发送
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isStreaming) stop();
                    clearError();
                  }}
                  className="rounded-md border border-red-200 px-2.5 py-1 text-[11px] text-red-600 transition-colors hover:bg-red-100"
                >
                  关闭
                </button>
                <span className="text-[11px] text-red-500">未发送的内容已回填到输入框</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        disabled={isStreaming || !currentConversationId}
        placeholder={currentConversationId ? "输入问题，Enter 发送 / Shift+Enter 换行" : "正在初始化会话…"}
      />
    </div>
  );
}
