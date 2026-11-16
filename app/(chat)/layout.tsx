// 全局骨架：左侧会话侧栏 + 右侧主区。<768px 时侧栏由 Sidebar 内部切换为抽屉，不占布局宽度。
import GraphSidebar from "@/components/graph/GraphSidebar";
import Sidebar from "@/components/layout/Sidebar";

export default function ChatGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-neutral-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
      {/* 右侧知识图谱抽屉（由侧栏按钮控制开合） */}
      <GraphSidebar />
    </div>
  );
}
