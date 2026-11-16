"use client";

// 底部输入框（受控）：Enter 发送、Shift+Enter 换行、生成中禁用；中文输入法组词时不会误发送。
// 内容由外部（chat store 的 draft）持有，发送失败时可以原样回填。

import { type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  /** 生成中 / 会话未就绪时禁用 */
  disabled?: boolean;
  placeholder?: string;
}

const MAX_LENGTH = 1000;

export default function ChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder,
}: ChatInputProps) {
  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组词中按 Enter 是确认候选词，不能当作发送
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-neutral-200 bg-white px-4 py-3"
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        placeholder={placeholder ?? "输入问题，Enter 发送 / Shift+Enter 换行"}
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:cursor-not-allowed disabled:bg-neutral-50"
      />
      <Button type="submit" disabled={disabled || value.trim().length === 0} className="h-10 px-5">
        {disabled ? "生成中…" : "发送"}
      </Button>
    </form>
  );
}
