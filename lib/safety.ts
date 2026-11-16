// 安全防线：① Prompt 注入检测 ② 敏感词过滤 ③ 输出兜底。
// 全部为纯函数，服务端（route）使用；命中即返回固定中文文案，不依赖模型判断。

/** precise 模式的标准拒答文案（检索不到依据时使用，保证措辞稳定） */
export const PRECISE_REFUSAL =
  "所上传资料中未找到与该问题直接相关的内容。您可以切换到探索模式尝试获得补充回答。";

/** 注入类提问的拦截回复 */
export const INJECTION_REPLY = "我无法执行这类指令。请直接提出与课程内容相关的问题。";

/** 敏感词命中时的拦截回复 */
export const SENSITIVE_REPLY = "该提问包含不适宜的内容，已拦截。请换一种问法。";

/** 输出未通过检查时的降级文案 */
export const OUTPUT_FALLBACK = "抱歉，本次回答未通过内容安全检查，已隐藏。请换个问法或稍后重试。";

/** 回答长度上限（字符），超出后截断 */
export const MAX_ANSWER_CHARS = 4000;

/**
 * Prompt 注入 / 越狱特征。
 * 只覆盖常见表达，宁可漏杀不做过度误伤（误伤会让正常提问被拦截）。
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /忽略(掉)?(之前|以上|上面|先前|前面|上述)(的)?(所有|全部)?(指令|规则|设定|提示|要求)/,
  /无视(之前|以上|上面|先前|前面)(的)?(所有|全部)?(指令|规则|限制)/,
  /(输出|展示|显示|打印|重复|复述|告诉我|泄露|透露).{0,8}(系统提示词|系统指令|system\s*prompt)/i,
  /(你的|your)\s*(系统提示词|system\s*prompt|系统指令)/i,
  /ignore\s+(all\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above)\s+(instructions?|rules?)/i,
  /(repeat|print|show|reveal)\s+(me\s+)?(your\s+)?(system|initial|hidden)\s+(prompt|instructions?)/i,
  /(jailbreak|developer\s*mode|dan\s*mode|越狱|开发者模式)/i,
];

/** 轻量敏感词表（短语级，降低误伤；可按需扩充） */
const SENSITIVE_WORDS: readonly string[] = [
  "制作炸弹",
  "炸弹配方",
  "爆炸物制作",
  "购买枪支",
  "枪支弹药",
  "毒品交易",
  "制毒",
  "贩毒",
  "自杀方法",
  "自残方法",
  "色情",
  "裸聊",
  "赌博网站",
  "洗钱",
  "电信诈骗",
  "信用卡盗刷",
  "木马病毒制作",
  "黑客攻击教程",
  "翻墙软件",
];

/** 命中类型 */
export type SafetyAction = "ok" | "injection" | "sensitive" | "empty" | "too_long";

export interface InputCheckResult {
  blocked: boolean;
  action: SafetyAction;
  /** 被拦截时直接下发给用户的回复 */
  reply?: string;
}

export interface OutputCheckResult {
  /** 通过检查的文本；未通过时为降级文案或截断结果 */
  text: string;
  action: SafetyAction;
}

/** 归一化：折叠空白并转小写，避免「忽 略 之前 指令」这类绕过 */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

function matchSensitive(normalized: string): string | undefined {
  return SENSITIVE_WORDS.find((word) => normalized.includes(word.toLowerCase()));
}

/** 输入检测：注入 → 敏感词（命中则调用方应跳过 LLM，直接返回 reply） */
export function checkInput(question: string): InputCheckResult {
  const normalized = normalize(question);

  if (INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { blocked: true, action: "injection", reply: INJECTION_REPLY };
  }

  if (matchSensitive(normalized)) {
    return { blocked: true, action: "sensitive", reply: SENSITIVE_REPLY };
  }

  return { blocked: false, action: "ok" };
}

/** 输出检测：空回复 / 命中敏感词 / 超长，分别给出降级结果 */
export function checkOutput(answer: string): OutputCheckResult {
  const trimmed = answer.trim();

  if (!trimmed) {
    return { text: OUTPUT_FALLBACK, action: "empty" };
  }

  if (matchSensitive(normalize(trimmed))) {
    return { text: OUTPUT_FALLBACK, action: "sensitive" };
  }

  if (trimmed.length > MAX_ANSWER_CHARS) {
    return {
      text: `${trimmed.slice(0, MAX_ANSWER_CHARS)}…\n\n（回答过长，已截断）`,
      action: "too_long",
    };
  }

  return { text: trimmed, action: "ok" };
}
