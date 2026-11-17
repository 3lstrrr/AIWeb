"use client";

// 全局侧栏：会话列表（新建 / 重命名 / 删除 / 按标题搜索）+ 文档管理与调试入口。
// 桌面端常驻，宽度 < 768px 时变成抽屉；所有请求失败统一走中文 toast。

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, ListChecks, Pencil, Search, Waypoints, X } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError, readApiError } from "@/lib/api-error";
import { createId } from "@/lib/id";
import { useChatStore } from "@/stores/chat";
import { useGraphStore } from "@/stores/graph";
import type { Conversation } from "@/types";

/** 底部工具入口：与会话列表统一字号与行高，图标用 lucide 保证跨平台一致 */
const TOOL_LINKS = [
  { href: "/upload", label: "文档管理", icon: FileText },
  { href: "/quiz", label: "AI 出题", icon: ListChecks },
  { href: "/debug", label: "检索调试", icon: Search },
] as const;

export default function Sidebar() {
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const setConversations = useChatStore((state) => state.setConversations);
  const setCurrentConversationId = useChatStore((state) => state.setCurrentConversationId);
  const setMessages = useChatStore((state) => state.setMessages);
  const openGraphDrawer = useGraphStore((state) => state.openDrawer);

  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // 移动端抽屉：Esc 关闭（键盘用户与桌面窄窗口都能用）
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // 进入页面时从数据库拉取会话列表
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/conversations", { cache: "no-store" });
        const payload: unknown = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          toast.error(readApiError(payload, "会话列表加载失败"));
          return;
        }
        setConversations((payload as { conversations: Conversation[] }).conversations);
      } catch (error) {
        if (!cancelled) toast.error(describeError(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setConversations]);

  const handleCreate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        toast.error(readApiError(payload, "新建会话失败"));
        return;
      }
      const conversation = (payload as { conversation: Conversation }).conversation;
      setConversations([conversation, ...useChatStore.getState().conversations]);
      setCurrentConversationId(conversation.id);
      setMessages([]);
      setOpen(false);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }, [busy, setConversations, setCurrentConversationId, setMessages]);

  const commitRename = async (id: string) => {
    const title = editingTitle.trim();
    setEditingId(null);
    if (!title) return;

    const previous = useChatStore.getState().conversations;
    setConversations(previous.map((item) => (item.id === id ? { ...item, title } : item)));

    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        setConversations(previous); // 回滚
        toast.error(readApiError(await response.json(), "重命名失败"));
      }
    } catch (error) {
      setConversations(previous);
      toast.error(describeError(error));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("删除该会话及其全部消息？此操作不可恢复。")) return;
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!response.ok) {
        toast.error(readApiError(await response.json(), "删除会话失败"));
        return;
      }
      setConversations(useChatStore.getState().conversations.filter((item) => item.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(createId());
        setMessages([]);
      }
      toast.success("会话已删除");
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  const handleSelect = (id: string) => {
    if (id !== currentConversationId) {
      setCurrentConversationId(id);
      setMessages([]);
    }
    setOpen(false);
  };

  const lowerKeyword = keyword.trim().toLowerCase();
  const visibleConversations = lowerKeyword
    ? conversations.filter((item) => item.title.toLowerCase().includes(lowerKeyword))
    : conversations;

  return (
    <>
      {/* 移动端：汉堡按钮 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开侧栏"
        className="fixed left-2 top-2 z-40 rounded-lg border border-neutral-200 bg-white/90 px-2 py-1 text-sm text-neutral-600 shadow-sm backdrop-blur md:hidden"
      >
        ☰
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-neutral-200 px-3 py-3">
          <Link href="/" className="block px-1" onClick={() => setOpen(false)}>
            <span className="text-sm font-semibold text-neutral-900">智学 · AI 课程答疑</span>
            <span className="mt-0.5 block text-[11px] text-neutral-400">RAG + 引用溯源</span>
          </Link>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy}
            className="mt-2 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
          >
            {busy ? "创建中…" : "+ 新建对话"}
          </button>

          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索会话标题…"
            className="mt-2 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
          />
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {/* 异步加载骨架 */}
          {loading && conversations.length === 0 && (
            <div className="space-y-2 p-1">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-8 w-full rounded-lg" />
              ))}
            </div>
          )}

          {!loading && visibleConversations.length === 0 && (
            <p className="px-2 py-4 text-xs text-neutral-400">
              {conversations.length === 0 ? "暂无会话，直接提问即可自动创建" : "没有匹配的会话"}
            </p>
          )}

          {visibleConversations.map((item) => {
            const active = item.id === currentConversationId;
            const editing = editingId === item.id;

            return (
              <div
                key={item.id}
                className={`group mb-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                  active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                {editing ? (
                  // 编辑态必须有独立底色：active 行是深色背景，只用 text-* 会让文字融进背景
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onFocus={(event) => event.target.select()}
                    onBlur={() => void commitRename(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void commitRename(item.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-neutral-400 bg-white px-1.5 py-0.5 text-sm text-neutral-900 outline-none ring-2 ring-white/60"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    onDoubleClick={() => {
                      setEditingId(item.id);
                      setEditingTitle(item.title);
                    }}
                    className="min-w-0 flex-1 truncate text-left"
                    title={item.title}
                  >
                    {item.title}
                  </button>
                )}

                {!editing && (
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditingTitle(item.title);
                      }}
                      aria-label="重命名"
                      title="重命名"
                      className={`rounded p-1 transition-colors ${
                        active ? "hover:bg-white/20" : "hover:bg-neutral-200"
                      }`}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item.id)}
                      aria-label="删除"
                      title="删除"
                      className={`rounded p-1 transition-colors ${
                        active ? "hover:bg-white/20" : "hover:bg-neutral-200"
                      }`}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-neutral-200 p-2">
          <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium tracking-wide text-neutral-400">
            工具
          </p>

          <button
            type="button"
            onClick={() => {
              openGraphDrawer();
              setOpen(false);
            }}
            className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100"
          >
            <Waypoints className="size-4 shrink-0 text-neutral-400" aria-hidden />
            知识图谱
          </button>

          {TOOL_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100"
              >
                <Icon className="size-4 shrink-0 text-neutral-400" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      </aside>
    </>
  );
}
