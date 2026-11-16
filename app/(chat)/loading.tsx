// 路由级加载骨架：页面数据（会话 / 文档）拉取期间占位，避免白屏或布局跳动。
export default function ChatGroupLoading() {
  return (
    <div className="flex h-full w-full flex-col bg-neutral-50" aria-busy="true" aria-live="polite">
      <div className="border-b border-neutral-200 bg-white px-4 py-3">
        <div className="h-3.5 w-40 animate-pulse rounded bg-neutral-200" />
        <div className="mt-2 h-2.5 w-64 animate-pulse rounded bg-neutral-100" />
      </div>

      <div className="flex-1 space-y-4 px-6 py-6">
        <div className="h-14 w-3/4 animate-pulse rounded-xl bg-neutral-100" />
        <div className="ml-auto h-14 w-2/3 animate-pulse rounded-xl bg-neutral-200/70" />
        <div className="h-20 w-3/4 animate-pulse rounded-xl bg-neutral-100" />
      </div>

      <div className="border-t border-neutral-200 bg-white px-4 py-3">
        <div className="h-10 w-full animate-pulse rounded-lg bg-neutral-100" />
      </div>
    </div>
  );
}
