// 文本切块：按段落边界累积到 token 预算，保留 overlap 重叠，并记录每块起始页码。
// 页码约定：text 用 PAGE_BREAK（U+001E）分隔页面（PDF 解析时逐页写入）；txt 无分页符，整篇记为第 1 页。

/** 切块产物：尚未落库，缺 id / document_id / embedding */
export interface ChunkDraft {
  content: string;
  page_num: number;
  token_count: number;
}

/**
 * 分页符：多字符哨兵（NUL 包裹的 ASCII 标记）。
 * 不用 "\f" 或 U+001E 等单字符：实测某些 PDF 正文里自带整段控制字符（\u0002-\u001f 齐全），
 * 单字符分隔符会被正文撞车导致页码错乱，多字符标记才安全。
 */
export const PAGE_BREAK = "\u0000ZX_PAGE_BREAK\u0000";

/** 块内段落之间的连接符；它本身也消耗 token，预算必须计入 */
const SEGMENT_SEPARATOR = "\n\n";

/** 中日韩统一表意文字（含扩展 A 与兼容区） */
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

/** 段落之间的空行 */
const PARAGRAPH_BREAK = /\n\s*\n+/;

/** 句末标点（用于把超长段落拆成句子） */
const SENTENCE_BREAK = /(?<=[。！？!?；;：:.])/;

/**
 * 估算 token 数：中文按 1.5 字符/token，其余字符（英文、数字、标点）按 4 字符/token。
 * 仅用于切块预算与展示，不追求与模型 tokenizer 完全一致。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_PATTERN) ?? []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + otherCount / 4);
}

/** 一个连接符的估算 token 数（放在 estimateTokens 之后初始化，避免 CJK_PATTERN 的 TDZ 问题） */
const SEPARATOR_TOKENS = estimateTokens(SEGMENT_SEPARATOR);

interface Segment {
  text: string;
  page: number;
  tokens: number;
}

function toSegment(text: string, page: number): Segment {
  return { text, page, tokens: estimateTokens(text) };
}

/** 把超过预算的段落拆成句子，单句仍超长则按字符硬切，保证每段都不超 maxTokens */
function splitLongParagraph(paragraph: string, page: number, maxTokens: number): Segment[] {
  const segments: Segment[] = [];
  let buffer = "";

  const flushBuffer = () => {
    const text = buffer.trim();
    if (text) segments.push(toSegment(text, page));
    buffer = "";
  };

  for (const sentence of paragraph.split(SENTENCE_BREAK)) {
    if (!sentence) continue;
    const candidate = buffer + sentence;
    if (estimateTokens(candidate) <= maxTokens) {
      buffer = candidate;
      continue;
    }
    flushBuffer();
    if (estimateTokens(sentence) <= maxTokens) {
      buffer = sentence;
      continue;
    }
    // 单句仍超预算（如无标点长公式 / 英文连写）：按字符硬切
    const hardLimit = Math.max(1, Math.floor(maxTokens * 1.5));
    for (let i = 0; i < sentence.length; i += hardLimit) {
      segments.push(toSegment(sentence.slice(i, i + hardLimit), page));
    }
  }
  flushBuffer();

  return segments;
}

/** 单页文本 -> 段落片段（保留页码） */
function splitPage(pageText: string, page: number, maxTokens: number): Segment[] {
  return pageText
    .split(PARAGRAPH_BREAK)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .flatMap((paragraph) =>
      estimateTokens(paragraph) <= maxTokens
        ? [toSegment(paragraph, page)]
        : splitLongParagraph(paragraph, page, maxTokens),
    );
}

/**
 * 按段落边界切块。
 * @param text 全文（页面之间用 "\f" 分隔）
 * @param maxTokens 单块 token 上限，默认 512
 * @param overlap 相邻块重叠 token 数，默认 64（会被限制在 maxTokens/2 以内）
 * @returns 顺序排列的切块，page_num 为该块起始文本所在页码（从 1 开始）
 */
export function splitIntoChunks(text: string, maxTokens = 512, overlap = 64): ChunkDraft[] {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new Error("maxTokens 必须是大于 0 的数字");
  }

  const safeMaxTokens = Math.floor(maxTokens);
  const safeOverlap = Math.max(
    0,
    Math.min(Math.floor(Number.isFinite(overlap) ? overlap : 0), Math.floor(safeMaxTokens / 2)),
  );

  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const segments = normalized
    .split(PAGE_BREAK)
    .flatMap((pageText, pageIndex) =>
      pageText.trim() ? splitPage(pageText, pageIndex + 1, safeMaxTokens) : [],
    );

  const chunks: ChunkDraft[] = [];
  let current: Segment[] = [];
  let currentTokens = 0;

  /** 输出当前块，并把尾部不超过 overlap 的片段留作下一块开头 */
  const flush = () => {
    if (current.length === 0) return;

    const content = current.map((segment) => segment.text).join(SEGMENT_SEPARATOR);
    chunks.push({ content, page_num: current[0].page, token_count: estimateTokens(content) });

    const tail: Segment[] = [];
    let tailTokens = 0;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const segment = current[i];
      const separatorTokens = tail.length > 0 ? SEPARATOR_TOKENS : 0;
      if (tailTokens + separatorTokens + segment.tokens > safeOverlap) break;
      tail.unshift(segment);
      tailTokens += separatorTokens + segment.tokens;
    }

    // 整块都被当成重叠会退化成重复内容，此时不保留重叠
    current = tail.length === current.length ? [] : tail;
    currentTokens = current.length === 0 ? 0 : tailTokens;
  };

  for (const segment of segments) {
    const fits = (tokens: number, hasCurrent: boolean) =>
      tokens + (hasCurrent ? SEPARATOR_TOKENS : 0) + segment.tokens;

    if (currentTokens > 0 && fits(currentTokens, current.length > 0) > safeMaxTokens) {
      flush();
      // flush 会带回重叠片段；若重叠 + 本段仍超预算，只能丢弃重叠从空块开始
      if (currentTokens > 0 && fits(currentTokens, current.length > 0) > safeMaxTokens) {
        current = [];
        currentTokens = 0;
      }
    }

    currentTokens += (current.length > 0 ? SEPARATOR_TOKENS : 0) + segment.tokens;
    current.push(segment);
  }
  flush();

  return chunks;
}
