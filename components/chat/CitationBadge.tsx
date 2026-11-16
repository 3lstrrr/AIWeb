"use client";

// 引用角标：把回答里的 [n] 渲染为可点击的上标徽标，点击后回调 index（P8 接引用详情面板）。

interface CitationBadgeProps {
  index: number;
  onClick?: (index: number) => void;
}

export default function CitationBadge({ index, onClick }: CitationBadgeProps) {
  return (
    <sup className="ml-0.5 inline-flex">
      <button
        type="button"
        onClick={() => onClick?.(index)}
        title={`引用片段 [${index}]`}
        aria-label={`查看引用 ${index}`}
        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-100 px-1 text-[10px] font-medium leading-none text-blue-700 transition-colors hover:bg-blue-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400"
      >
        {index}
      </button>
    </sup>
  );
}
