// 聊天界面状态：会话列表、当前会话消息、流式状态与问答模式。
// 只持久化「当前会话 id」与「模式」：消息体量大且以数据库为准，不放进 localStorage。

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, ChatMode, Conversation } from "@/types";

interface ChatState {
  /** 会话列表（进入页面时从数据库加载） */
  conversations: Conversation[];
  /** 当前会话 id；为空表示尚未初始化 */
  currentConversationId: string;
  /** 当前会话的消息（与 useChat 的 messages 保持同步） */
  currentMessages: ChatMessage[];
  /** 是否正在流式生成（供输入框禁用、光标闪烁等使用） */
  isStreaming: boolean;
  /** 问答模式：精确 / 探索 */
  mode: ChatMode;
  /** 输入框草稿：发送失败时用于恢复未发出的内容 */
  draft: string;
  setDraft: (draft: string) => void;
  setConversations: (conversations: Conversation[]) => void;
  setCurrentConversationId: (id: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setMode: (mode: ChatMode) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      conversations: [],
      currentConversationId: "",
      currentMessages: [],
      isStreaming: false,
      mode: "precise",
      draft: "",

      setDraft: (draft) => set({ draft }),
      setConversations: (conversations) => set({ conversations }),
      setCurrentConversationId: (currentConversationId) => set({ currentConversationId }),
      setMessages: (currentMessages) => set({ currentMessages }),
      setIsStreaming: (isStreaming) => set({ isStreaming }),
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "zhixue-chat",
      partialize: (state) => ({
        currentConversationId: state.currentConversationId,
        mode: state.mode,
      }),
      // 手动 rehydrate：避免 SSR 输出与服务端首次渲染不一致导致 hydration 警告
      skipHydration: true,
    },
  ),
);
