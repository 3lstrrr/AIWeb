"use client";

// AI 思考中提示：三个点依次跳动，用于「已发送、还没收到首字」的等待阶段。

export default function ThinkingIndicator({ label = "AI 正在思考" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500" role="status" aria-live="polite">
      <span className="flex items-end gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400"
            style={{ animationDelay: `${index * 140}ms` }}
          />
        ))}
      </span>
      {label}…
    </div>
  );
}
