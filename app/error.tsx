"use client";

// 路由级错误边界：页面渲染或数据加载抛错时展示友好页，提供重试与返回首页（不出现白屏）。

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] 页面渲染异常：", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="text-4xl" aria-hidden>
        ⚠️
      </div>
      <h1 className="text-lg font-semibold text-neutral-900">页面出了点问题</h1>
      <p className="max-w-md text-sm leading-relaxed text-neutral-500">
        可能是网络中断或服务暂时不可用。你可以重试；如果反复失败，请检查网络与 `.env.local`
        中的密钥配置后重启服务。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset} className="h-9 px-5">
          重试
        </Button>
        <Link
          href="/"
          className="inline-flex h-9 items-center rounded-lg border border-neutral-200 px-5 text-sm text-neutral-600 transition-colors hover:bg-neutral-100"
        >
          返回首页
        </Link>
      </div>
      <p className="max-w-md break-all font-mono text-[11px] text-neutral-400">{error.message}</p>
    </div>
  );
}
