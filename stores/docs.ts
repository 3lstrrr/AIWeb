// 文档状态：上传队列（含进度与阶段）+ 知识库文档列表 + 聊天时的文档过滤选择。

import { create } from "zustand";
import type { DocumentSummary } from "@/types";

/** 上传状态机：解析中 → 向量化中 → 就绪 / 失败 */
export type DocStatus = "parsing" | "embedding" | "ready" | "failed";

export interface DocItem {
  /** 上传阶段用临时 key，入库后换成真实 documentId */
  key: string;
  documentId: string | null;
  title: string;
  pageCount: number;
  chunkCount: number;
  status: DocStatus;
  /** 0-100，仅上传阶段有意义 */
  progress: number;
  error?: string;
}

interface DocsState {
  /** 上传队列 + 已入库文档（同一列表渲染） */
  items: DocItem[];
  /** 知识库文档（来自 /api/documents） */
  documents: DocumentSummary[];
  loading: boolean;
  /** 聊天时限定检索范围的文档 id；空串表示全库 */
  selectedDocumentId: string;
  addItems: (items: DocItem[]) => void;
  updateItem: (key: string, patch: Partial<DocItem>) => void;
  removeItem: (key: string) => void;
  setDocuments: (documents: DocumentSummary[]) => void;
  setLoading: (loading: boolean) => void;
  setSelectedDocumentId: (documentId: string) => void;
  clearFinished: () => void;
}

export const useDocsStore = create<DocsState>()((set) => ({
  items: [],
  documents: [],
  loading: false,
  selectedDocumentId: "",

  addItems: (items) => set((state) => ({ items: [...items, ...state.items] })),
  updateItem: (key, patch) =>
    set((state) => ({
      items: state.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    })),
  removeItem: (key) => set((state) => ({ items: state.items.filter((item) => item.key !== key) })),
  setDocuments: (documents) => set({ documents }),
  setLoading: (loading) => set({ loading }),
  setSelectedDocumentId: (selectedDocumentId) => set({ selectedDocumentId }),
  clearFinished: () =>
    set((state) => ({
      items: state.items.filter((item) => item.status === "parsing" || item.status === "embedding"),
    })),
}));
