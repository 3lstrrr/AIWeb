// 404 页面：访问不存在的路由时展示，引导回到对话首页。
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-neutral-50 px-6 text-center">
      <p className="font-mono text-5xl font-semibold text-neutral-300">404</p>
      <h1 className="text-lg font-semibold text-neutral-900">页面不存在</h1>
      <p className="max-w-sm text-sm leading-relaxed text-neutral-500">
        链接可能已失效，或者地址输错了。回到对话页继续提问吧。
      </p>
      <Link
        href="/"
        className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
      >
        返回对话
      </Link>
      <Link href="/upload" className="text-xs text-neutral-500 underline-offset-4 hover:underline">
        或前往文档管理
      </Link>
    </div>
  );
}
