// 聊天主页（服务端组件）：会话列表由全局侧栏自行拉取，这里只负责挂载客户端工作台。
import ChatWorkspace from "@/components/chat/ChatWorkspace";

export default function ChatPage() {
  return <ChatWorkspace />;
}
