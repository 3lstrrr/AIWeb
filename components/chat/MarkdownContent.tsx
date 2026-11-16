"use client";

// AI 回答的 Markdown 渲染：GFM 表格/列表 + 代码块高亮与一键复制 + [n] 引用角标。
// 引用替换在 rehype 层做（只改文本节点，跳过 pre/code），因此代码里的 arr[1] 不会被误改。

import { useCallback, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import CitationBadge from "@/components/chat/CitationBadge";
import { cn } from "@/lib/utils";
import type { Element, ElementContent, Root, Text } from "hast";

/** 引用角标：[1] [12] */
const CITATION_PATTERN = /\[(\d{1,2})\]/g;

/** 流式时结尾可能出现的半截角标：[、[1、[12 */
const TRAILING_PARTIAL_CITATION = /\[[0-9]{0,3}$/;

/** 逐字流式时，把结尾未闭合的 "[1" 先扣住，等 "]" 到达再一起渲染，避免出现半截角标 */
function bufferIncompleteCitation(text: string): string {
  return text.replace(TRAILING_PARTIAL_CITATION, "");
}

/** 递归取 hast 节点的纯文本（用于复制代码块） */
function collectText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(collectText).join("");
  return "";
}

/** 把一个文本节点按 [n] 切开，[n] 替换为 <sup data-citation="n"> */
function splitCitations(node: Text): ElementContent[] | null {
  const matches = [...node.value.matchAll(CITATION_PATTERN)];
  if (matches.length === 0) return null;

  const parts: ElementContent[] = [];
  let cursor = 0;

  for (const match of matches) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push({ type: "text", value: node.value.slice(cursor, start) });
    }
    parts.push({
      type: "element",
      tagName: "sup",
      properties: { dataCitation: match[1] },
      children: [{ type: "text", value: match[1] }],
    });
    cursor = start + match[0].length;
  }

  if (cursor < node.value.length) {
    parts.push({ type: "text", value: node.value.slice(cursor) });
  }
  return parts;
}

/** 遍历 hast 树替换引用；跳过 pre / code 子树，保证代码原样保留 */
function transform(parent: Root | Element): void {
  const children = parent.children as ElementContent[];

  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];

    if (child.type === "element") {
      if (child.tagName === "pre" || child.tagName === "code") continue;
      transform(child);
      continue;
    }

    if (child.type !== "text") continue;

    const replacement = splitCitations(child);
    if (replacement) children.splice(index, 1, ...replacement);
  }
}

/** 自定义 rehype 插件 */
function rehypeCitations() {
  return (tree: Root): void => {
    transform(tree);
  };
}

/** 代码块外壳：高亮内容 + 右上角一键复制 */
function CodeBlock({ raw, children }: { raw: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 非安全上下文或用户拒绝授权时静默失败，不打断阅读
    }
  }, [raw]);

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
        aria-label="复制代码"
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre className="overflow-x-auto px-3 py-3 pr-14 text-[12.5px] leading-relaxed text-neutral-800">
        {children}
      </pre>
    </div>
  );
}

interface MarkdownContentProps {
  content: string;
  /** 是否仍在流式输出 */
  streaming?: boolean;
  onCitationClick?: (index: number) => void;
}

export default function MarkdownContent({
  content,
  streaming = false,
  onCitationClick,
}: MarkdownContentProps) {
  const prepared = useMemo(
    () => (streaming ? bufferIncompleteCitation(content) : content),
    [content, streaming],
  );

  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => (
        <h1 className="mb-2 mt-5 text-lg font-semibold text-neutral-900">{children}</h1>
      ),
      h2: ({ children }) => (
        <h2 className="mb-2 mt-5 text-base font-semibold text-neutral-900">{children}</h2>
      ),
      h3: ({ children }) => (
        <h3 className="mb-1.5 mt-4 text-sm font-semibold text-neutral-900">{children}</h3>
      ),
      h4: ({ children }) => (
        <h4 className="mb-1.5 mt-3 text-sm font-medium text-neutral-800">{children}</h4>
      ),
      p: ({ children }) => <p className="my-2">{children}</p>,
      ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
      li: ({ children }) => <li className="marker:text-neutral-400">{children}</li>,
      strong: ({ children }) => (
        <strong className="font-semibold text-neutral-900">{children}</strong>
      ),
      em: ({ children }) => <em className="text-neutral-700">{children}</em>,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
        >
          {children}
        </a>
      ),
      blockquote: ({ children }) => (
        <blockquote className="my-3 border-l-2 border-neutral-300 pl-3 text-neutral-600">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-4 border-neutral-200" />,
      table: ({ children }) => (
        <div className="my-3 w-full overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full border-collapse text-left text-[13px]">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="bg-neutral-50 text-neutral-600">{children}</thead>,
      th: ({ children }) => (
        <th className="border-b border-neutral-200 px-3 py-1.5 font-medium">{children}</th>
      ),
      td: ({ children }) => (
        <td className="border-b border-neutral-100 px-3 py-1.5 align-top">{children}</td>
      ),
      pre: ({ node, children }) => <CodeBlock raw={node ? collectText(node) : ""}>{children}</CodeBlock>,
      code: ({ className, children, ...props }) => {
        // 代码块由 pre 包裹并已高亮；行内代码才加底色
        if (typeof className === "string" && /(?:language-|hljs)/.test(className)) {
          return (
            <code className={cn("font-mono", className)} {...props}>
              {children}
            </code>
          );
        }
        return (
          <code
            className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12.5px] text-neutral-800"
            {...props}
          >
            {children}
          </code>
        );
      },
      sup: ({ node, children, ...props }) => {
        const raw = node?.properties?.dataCitation;
        const index = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
        if (Number.isInteger(index) && index > 0) {
          return <CitationBadge index={index} onClick={onCitationClick} />;
        }
        return <sup {...props}>{children}</sup>;
      },
    }),
    [onCitationClick],
  );

  return (
    <div className="text-sm leading-relaxed text-neutral-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeCitations, rehypeHighlight]}
        components={components}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
