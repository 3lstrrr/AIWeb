// 全局共享类型定义：知识库文档、切片、会话、消息与引用溯源。
// 字段与 supabase/migrations/001_init.sql 中的表结构一一对应（时间戳均为 Supabase 返回的 ISO 字符串）。

/** 知识库文档（documents 表） */
export interface Document {
  id: string;
  title: string;
  file_type: string;
  file_size: number;
  page_count: number;
  created_at: string;
}

/** 文档切片（chunks 表）；embedding 为 1024 维向量，未入库前为 null */
export interface Chunk {
  id: string;
  document_id: string;
  content: string;
  page_num: number;
  embedding: number[] | null;
  token_count: number;
}

/** 会话（conversations 表） */
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** 消息角色 */
export type MessageRole = "user" | "assistant" | "system";

/** 消息（messages 表）；citations 仅 assistant 消息有，存为 jsonb */
export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  citations?: Citation[];
}

/** 引用溯源卡片：index 对应正文里的 [1] [2]，点击可跳原文页 */
export interface Citation {
  index: number;
  document_id: string;
  doc_title: string;
  page_num: number;
  snippet: string;
}

/** 问答模式：precise = 精确（严格阈值、保守回答）；explore = 探索（放宽检索、可扩展） */
export type ChatMode = "precise" | "explore";

/** match_documents RPC 的返回行（score 为余弦相似度，1 表示完全一致） */
export interface ChunkMatch {
  id: string;
  document_id: string;
  content: string;
  page_num: number;
  token_count: number;
  score: number;
}

/** 知识图谱节点 */
export interface GraphNode {
  id: string;
  label: string;
  /** 概念 / 方法 / 公式 / 结构 / 应用 */
  type: string;
}

/** 知识图谱边 */
export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

/** 文档知识图谱（缓存在 documents.graph_json） */
export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt?: string;
}

/** 出题题型 */
export type QuizQuestionType = "single" | "multiple" | "short";

/** 题目引用的原文位置 */
export interface QuizCitation {
  documentId: string;
  pageNum: number;
}

/** 一道题：选择题的 answer 是 0 起始下标数组，简答题是参考答案文本 */
export interface QuizQuestion {
  type: QuizQuestionType;
  stem: string;
  options?: string[];
  answer: number[] | string;
  explanation: string;
  citations: QuizCitation[];
}

/** Agent 工具调用日志（前端「思考日志」用） */
export interface QuizToolStep {
  step: number;
  tool: string;
  input: string;
  output: string;
}

/** /api/quiz 返回体 */
export interface QuizPayload {
  questions: QuizQuestion[];
  log: QuizToolStep[];
}

/** 文档列表项（/api/documents 返回，含切片统计） */
export interface DocumentSummary {
  id: string;
  title: string;
  fileType: string;
  fileSize: number;
  pageCount: number;
  chunkCount: number;
  /** 尚未向量化的切片数：>0 表示还在处理中 */
  pendingChunks: number;
  createdAt: string;
}

/** 前端渲染用的消息（由 AI SDK 的 UIMessage 归一化而来） */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
}

/** 检索结果项：/api/retrieve 返回、P5 聊天接口复用 */
export interface RetrievalResultItem {
  chunkId: string;
  documentId: string;
  docTitle: string;
  content: string;
  pageNum: number;
  /** 最终排序分：精排成功时为 rerank 分数，降级时为向量余弦相似度 */
  score: number;
  /** 向量余弦相似度（1 表示完全一致） */
  vectorScore: number;
  /** false 表示精排降级，此时 score 实为向量分 */
  reranked: boolean;
}

/** 所有 API 的错误码，便于前端按 code 分支处理文案 */
export type ApiErrorCode =
  | "CONFIG_MISSING"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_BODY"
  | "FILE_MISSING"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "EMPTY_DOCUMENT"
  | "PDF_PARSE_FAILED"
  | "STORAGE_BUCKET_MISSING"
  | "STORAGE_UPLOAD_FAILED"
  | "DB_QUERY_FAILED"
  | "DB_INSERT_FAILED"
  | "DB_UPDATE_FAILED"
  | "EMBEDDING_FAILED"
  | "DOCUMENT_NOT_FOUND"
  | "MIGRATION_REQUIRED"
  | "STORAGE_SIGN_FAILED"
  | "INTERNAL_ERROR";

/** 统一错误响应体：{ error: { code, message, failedChunkIds? } } */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** 批量操作失败时的问题行 id，便于人工排查 */
    failedChunkIds?: string[];
  };
}
