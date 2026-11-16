"use client";

// 精确 / 探索 分段切换控件：右侧「?」悬停或聚焦时显示模式说明（不引入额外 tooltip 依赖）。

import type { ChatMode } from "@/types";

interface ModeOption {
  value: ChatMode;
  label: string;
  tip: string;
}

const OPTIONS: readonly ModeOption[] = [
  {
    value: "precise",
    label: "精确",
    tip: "只依据检索到的课件内容作答，资料里没有就明确拒答，不编造。",
  },
  {
    value: "explore",
    label: "探索",
    tip: "允许结合模型通用知识，但必须用「资料依据」「模型补充」区分来源。",
  },
];

interface ModeSwitchProps {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled?: boolean;
}

export default function ModeSwitch({ value, onChange, disabled = false }: ModeSwitchProps) {
  return (
    <div className="relative flex items-center gap-1">
      <div
        role="group"
        aria-label="问答模式"
        className="flex items-center gap-1 rounded-lg border border-neutral-200 p-1"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={disabled}
            aria-pressed={value === option.value}
            title={option.tip}
            className={`rounded-md px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
              value === option.value
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:bg-neutral-100"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <span className="group relative inline-flex">
        <button
          type="button"
          aria-label="模式说明"
          className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-300 text-[10px] leading-none text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-700"
        >
          ?
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-60 rounded-lg border border-neutral-200 bg-white p-2.5 text-[11px] leading-relaxed text-neutral-600 shadow-lg group-hover:block group-focus-within:block"
        >
          {OPTIONS.map((option) => (
            <span key={option.value} className="mb-1 block last:mb-0">
              <span className="font-medium text-neutral-800">{option.label}</span>：{option.tip}
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}
