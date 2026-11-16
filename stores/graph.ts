// 知识图谱抽屉的开关与目标文档（侧栏按钮和抽屉分别在不同层级，用 store 共享状态）。

import { create } from "zustand";

interface GraphUiState {
  /** 抽屉是否展开 */
  open: boolean;
  /** 当前查看图谱的文档 */
  documentId: string;
  openDrawer: () => void;
  closeDrawer: () => void;
  setDocumentId: (documentId: string) => void;
}

export const useGraphStore = create<GraphUiState>()((set) => ({
  open: false,
  documentId: "",
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
  setDocumentId: (documentId) => set({ documentId }),
}));
