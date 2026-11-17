<div align="center">

# 智学 · AI 课程答疑助手

**上传课件 → 自动建库 → 带原文引用的流式问答 → 一键出题与知识图谱**

RAG 驱动的课程知识库问答系统 · Next.js 15 + Vercel AI SDK + Supabase pgvector + 智谱 GLM

[功能特性](#2-功能特性) · [技术架构](#3-技术架构) · [快速开始](#4-安装运行指南) · [环境变量](#5-环境变量说明) · [接口一览](#6-api-一览) · [团队](#7-团队信息)

</div>

---

## 1. 项目介绍

### 1.1 背景

大学生的复习材料高度分散：课件 PDF、教材扫描件、老师发的补充文献。期末复习时最常见的困境是——

- **找不到**：几十份 PDF 里翻一页内容，靠 Ctrl+F 一个个试；
- **不敢信**：直接问通用大模型，它可能一本正经地编造「你们老师没讲过的公式」；
- **改不动**：想自测掌握程度，只能手动出题。

### 1.2 我们的解法

「智学」把**你自己上传的课件**变成一座可检索、可溯源、可自测的知识库：

| 痛点 | 智学的做法 |
| --- | --- |
| 找不到 | 向量检索 + 精排，问题问到哪，原文片段就定位到哪 |
| 不敢信 | 每个结论都带 `[1] [2]` 角标，点一下右侧 PDF 直接翻页并高亮原句 |
| 想自测 | AI 出题 Agent 基于原文出题，题目必须可溯源，答完即时判分并给解析 |

**核心主张：宁可拒答，也不编造。** 精确模式下，检索不到依据就返回固定拒答文案，绝不调用模型的「想象力」。

### 1.3 在线体验

| 项 | 值 |
| --- | --- |
| 演示地址 | **http://8.137.96.36:8088** |
| 访问方式 | 若浏览器弹出账号密码框，说明演示环境启用了访问保护，**口令随提交材料一并提供**（不在公开仓库明文展示） |
| 建议体验路径 | 上传课件 → 等「就绪」→ 提问 → 点角标看原文 → 侧栏「AI 出题」「知识图谱」 |
| 运行环境 | 阿里云 ECS（Ubuntu 22.04）+ pm2 常驻 + Node 22 |

> 评审体验与演示前预热清单见 [`docs/REVIEW.md`](docs/REVIEW.md)。

---

## 2. 功能特性

### 2.1 文档入库

- 支持 **PDF / TXT** 拖拽上传（多选），单文件上限 20 MB；
- `pdf-parse` 逐页抽取文本 → 按段落边界切块（默认 **512 token / 64 重叠**，中文按 1.5 字符/token 估算）；
- 精确记录**每个切片所属页码**（用多字符分页哨兵，避开正文自带控制字符导致的页码错乱）；
- 原始文件存入 Supabase Storage **私有桶**，数据库只存元信息。

### 2.2 检索增强问答（RAG）

- 两段式检索：**向量召回 Top-8 → `bge-reranker-large` 精排 Top-4**；
- 精排接口异常时**自动降级**为向量顺序（返回体标记 `reranked: false`），不阻断问答；
- `streamText` 流式输出，逐字渲染，首字延迟约 1–2 秒。

### 2.3 双模式（可控性设计）

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| **精确（precise）** | 只依据检索片段作答；检索为空时返回固定拒答文案，**不调模型** | 复习、核对概念，要求零编造 |
| **探索（explore）** | 可结合通用知识，但必须用「（资料依据）」「（模型补充）」标注来源 | 拓展理解、跨章节联想 |

### 2.4 引用溯源（本项目的核心交互）

- 回答正文中的 `[n]` 渲染为可点击上标；代码块、行内的 `arr[1]` 不会被误替换（自定义 rehype 插件，只处理文本节点）；
- 流式过程中未闭合的 `[1` 会被**缓冲**，不会出现半截角标闪烁；
- 点击角标或「引用来源」卡片 → 右侧查看器**跳页 + 文本层高亮**（片段前缀 24/16/12/8/6 字逐级匹配，全不中则只跳页）；
- 桌面端左右分栏（分割线可拖拽），移动端上下堆叠且查看器可折叠。

### 2.5 AI 出题 Agent（Tool Calling）

- `generateText` + 两个工具构成 Agent 循环：
  - `retrieveForQuiz(topic)` —— 按主题检索原文；
  - `generateQuiz(questions)` —— 提交题目 JSON，**服务端校验题型/数量/引用是否可溯源**，不合规抛错让模型自我修正（最多 4 步）；
- 前端把工具调用过程渲染为**可折叠「思考日志」**，逐题作答、提交即时判分、展开解析与引用。

### 2.6 知识图谱

- 取文档切片 → 单次 `generateObject` 抽取实体关系（≤20 节点 / ≤30 边）→ 写入 `documents.graph_json` 缓存；
- 前端纯 SVG 力导向布局（斥力 + 弹簧 + 向心，260 次迭代，约 12 ms），节点可拖拽、点击只高亮相连的边。

### 2.7 安全与健壮性

| 防线 | 实现 |
| --- | --- |
| Prompt 注入检测 | 正则识别「忽略之前指令 / ignore previous / 输出你的 system prompt」等，命中即**不调模型**、直接返回安全回复 |
| 敏感词过滤 | 轻量短语词表，命中即拦截（刻意避免单词误伤，如化学课件里的「炸弹」） |
| 输出兜底 | 空回复 / 命中敏感词 → 降级文案；超长 → 截断并提示 |
| 全局错误处理 | 统一 `{ error: { code, message } }`、路由级错误页、404 页、全站中文 toast、骨架屏 |
| 可选访问门禁 | `middleware.ts` 的 HTTP Basic 认证（不配则不启用） |

### 2.8 工程化

- 统一错误码与中文文案，前端所有失败均有 toast + 重试；
- 消息发送失败**保留草稿**，提供「重试发送」（`regenerate`，不重复插入提问）；
- 全站元信息（title / description / OG 图 / favicon）；
- 重组件按需加载：`react-pdf`、markdown 渲染栈均为异步 chunk，不进首屏。

---

## 3. 技术架构

### 3.1 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端框架 | **Next.js 15.5**（App Router）+ React 19 + TypeScript 严格模式 | 全栈一体，Route Handlers 承载 API |
| 样式 | Tailwind CSS v4 + shadcn/ui + lucide 图标 | 无第三方主题依赖 |
| 状态 | Zustand（chat / docs / quiz / graph 四个 store） | 会话 id 持久化到 localStorage |
| AI 编排 | **Vercel AI SDK v5**（`ai` + `@ai-sdk/react` + `@ai-sdk/openai-compatible`） | `streamText` / `generateText` / `generateObject` / `useChat` |
| LLM | **智谱 `glm-4.7-flash`**（免费档） | OpenAI 兼容接口，temperature 0.3，maxOutputTokens 2048 |
| Embedding | 智谱 `embedding-3`，**1024 维** | 32 条/批，3 次指数退避重试（1s/2s/4s） |
| Rerank | 智谱 `bge-reranker-large` | 精排 Top-K，失败自动降级 |
| 向量库 | **Supabase Postgres + pgvector** | `chunks.embedding vector(1024)` + ivfflat 余弦索引 + `match_documents` RPC |
| 文件存储 | Supabase Storage 私有桶 `documents` | 客户端只拿 10 分钟有效的 signed URL |
| PDF 解析 | `pdf-parse`（引 `lib/pdf-parse.js`，避开主入口的调试代码） | Node runtime |
| PDF 渲染 | `react-pdf`（pdf.js）+ 自托管 worker | `dynamic(ssr:false)`，文本层高亮 |

### 3.2 系统架构（ASCII）

```text
┌────────────────────── 浏览器：React 19 / Next.js App Router ──────────────────────┐
│                                                                                   │
│   /          聊天工作台：流式回答 + [n] 角标 + PDF 原文分栏（可拖拽）             │
│   /upload    文档管理：拖拽多文件上传 + 解析/向量化状态 + 文档卡片                │
│   /quiz      AI 出题：可折叠思考日志 + 交互答题 + 即时判分                          │
│   /debug     检索调试：Top-K 片段 / 页码 / 分数着色（非面向用户）                  │
│                                                                                   │
└───────────────┬───────────────────────────────────────────┬───────────────────────┘
                │ fetch / SSE (text/event-stream)           │ pdf.js
                ▼                                           ▼
┌───────────────── Next.js Route Handlers（Node 运行时）───────────────────────────┐
│                                                                                  │
│  POST /api/ingest      pdf-parse → 切块(512/64) → 写库 → 存 Storage               │
│  POST /api/embed       分批向量化 → 回填 chunks.embedding（幂等，只补 NULL）      │
│  POST /api/retrieve    向量召回 Top-8 → rerank 精排 Top-4（失败降级为向量序）     │
│  POST /api/chat        安全检测 → 检索 → streamText → SSE + citations 元数据      │
│  POST /api/quiz        generateText + tools（retrieveForQuiz / generateQuiz）     │
│  POST /api/graph       generateObject 抽实体关系 → 缓存 documents.graph_json      │
│  GET  /api/documents…  文档列表/删除；/url 签 10 分钟 signed URL                  │
│  GET/POST/PATCH/DELETE /api/conversations…  会话增删改查                          │
│                                                                                  │
└───────────────┬──────────────────────────────────────────┬───────────────────────┘
                │                                          │
                ▼                                          ▼
┌────────────────────────────────────────┐  ┌──────────────────────────────────────┐
│ Supabase（Postgres + pgvector）        │  │ 智谱开放平台（OpenAI 兼容）           │
│                                        │  │                                      │
│  documents   文件元信息 + graph_json   │  │  glm-4.7-flash    对话（免费）        │
│  chunks      content + vector(1024)    │  │  embedding-3      1024 维向量         │
│  conversations / messages  会话与消息  │  │  bge-reranker-large  精排            │
│  match_documents()  向量检索 RPC       │  │                                      │
│  Storage: documents 私有桶             │  │                                      │
└────────────────────────────────────────┘  └──────────────────────────────────────┘
```

### 3.3 问答链路（数据流）

```text
用户提问
  │
  ├─① 输入安全检测 ──命中注入/敏感词──→ 固定安全回复（不调模型，SSE 直出并落库）
  │
  ├─② embedQuery(question) ──────────→ 1024 维向量
  │
  ├─③ match_documents(vector, docIds, 8) ─→ 候选片段（含页码）
  │        └─ 无结果且为 precise 模式 ──→ 标准拒答文案
  │
  ├─④ bge-reranker 精排 ─→ Top-4（异常则保持向量顺序，reranked=false）
  │
  ├─⑤ 组装 System Prompt（模式规则 + 引用规则 + context）
  │
  ├─⑥ streamText(glm-4.7-flash, temperature=0.3) ─→ SSE 逐字下发
  │
  └─⑦ onFinish：输出兜底 → 落库 messages（citations 只存真正被引用的角标）
```

### 3.4 目录结构

```text
app/
  (chat)/
    page.tsx            聊天工作台入口（静态壳）
    upload/page.tsx     文档管理
    quiz/page.tsx       AI 出题
    debug/page.tsx      检索调试
    layout.tsx          侧栏 + 抽屉 + 图谱抽屉挂载
    loading.tsx         路由骨架屏
  api/
    ingest/ embed/ retrieve/ chat/ quiz/ graph/
    documents/[documentId]/{route,url}
    conversations/{route,[conversationId]}
  error.tsx  global-error.tsx  not-found.tsx  layout.tsx  icon.svg  opengraph-image.tsx
components/
  chat/     ChatWindow / ChatWorkspace / MessageBubble / ChatInput / MarkdownContent
            CitationBadge / CitationCard / ModeSwitch / ThinkingIndicator
  viewer/   PdfViewer（react-pdf，动态加载）
  graph/    GraphSidebar（SVG 力导向）
  layout/   Sidebar
  ui/       button / input / badge / skeleton / sonner
lib/
  llm.ts embedding.ts retrieval.ts rerank.ts chunker.ts safety.ts
  supabase.ts env.ts api-error.ts id.ts utils.ts
stores/     chat / docs / quiz / graph
types/      index.ts（所有类型集中）
supabase/migrations/  001_init.sql  002_add_graph_json.sql
deploy/     nginx.conf  setup.sh
docs/       DEPLOYMENT.md  REVIEW.md  tech-doc-outline.md
middleware.ts           可选 Basic Auth 门禁
instrumentation.ts      启动期环境变量校验
```

---

## 4. 安装运行指南

### 4.1 前置要求

| 项 | 要求 |
| --- | --- |
| Node.js | **≥ 22**（`openai@7`、`@supabase/supabase-js@2.119`、`pdfjs-dist` 均要求 ≥22） |
| Supabase | 一个项目（免费额度足够） |
| 智谱 | [open.bigmodel.cn](https://open.bigmodel.cn) 的 API Key（`glm-4.7-flash` 免费） |

### 4.2 五步启动

```bash
# ① 拉代码 + 装依赖
git clone https://github.com/3lstrrr/AIWeb.git && cd AIWeb
npm ci

# ② 配置环境变量（见第 5 节）
cp .env.example .env.local
# 编辑 .env.local，填入 ZHIPU_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
```

**③ 初始化数据库**：Supabase 控制台 → **SQL Editor** → New query → 依次粘贴并 Run：

| 顺序 | 文件 | 作用 |
| --- | --- | --- |
| 1 | `supabase/migrations/001_init.sql` | 四张表 + `vector(1024)` + 余弦索引 + `match_documents` RPC + RLS |
| 2 | `supabase/migrations/002_add_graph_json.sql` | `documents.graph_json`（知识图谱缓存） |

成功提示 `Success. No rows returned`；脚本幂等，可重复执行。

**④ 建 Storage 桶**：Supabase → **Storage → New bucket** → 名称 `documents` → **不要勾 Public**。
（服务端用 service_role 读写，自动绕过 RLS，无需额外策略。）

```bash
# ⑤ 开发运行
npm run dev          # http://localhost:3000

# 生产构建（低配机器建议这样构建，避免 Turbopack 吃内存）
NODE_OPTIONS="--max-old-space-size=2048" npx next build
npm run start
```

### 4.3 自检清单

| 检查 | 期望 |
| --- | --- |
| 首页可访问 | `200`，侧栏有「新建对话」「文档管理」 |
| 上传一份文本型 PDF | 卡片状态走完 `解析中 → 向量化中 → 就绪` |
| 提问课件内概念 | 逐字流式输出，句末带 `[1]` 角标 |
| 点角标 | 右侧 PDF 翻到对应页并高亮片段 |
| `/debug` 输入问题 | 表格返回 Top-4 片段，右上角标记「已精排」 |

### 4.4 生产部署

- **自托管（阿里云 ECS 等）**：见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) 的 VPS 章节，配套 `deploy/nginx.conf`（含 `client_max_body_size 25m`、SSE 必须的 `proxy_buffering off`）与 `deploy/setup.sh`。
- **Serverless（Vercel）**：注意 **4.5 MB 请求体上限**，大 PDF 需改 Storage 直传。
- **容器化**：仓库提供 `Dockerfile`（监听 7860）与 `.devcontainer/`（Codespaces 一键环境）。

---

## 5. 环境变量说明

复制 `.env.example` → `.env.local`（Vercel/服务器则在平台后台逐条配置）：

| 变量 | 必填 | 说明 | 生效时机 |
| --- | --- | --- | --- |
| `ZHIPU_API_KEY` | ✅ | 智谱 Key，LLM / Embedding / Rerank 共用 | 运行时 |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | 形如 `https://xxxx.supabase.co` | **构建期内联** |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | service_role 密钥，**绝不能加 `NEXT_PUBLIC_`** | 运行时 |
| `NEXT_PUBLIC_SITE_URL` | ⭕ 建议 | 线上地址，用于 OG 分享卡片绝对路径 | **构建期内联** |
| `BASIC_AUTH_USER` | ⭕ | 与下一项同时填写才启用全站 HTTP Basic 认证 | 运行时 |
| `BASIC_AUTH_PASSWORD` | ⭕ | 评审访问口令 | 运行时 |

> ⚠️ 两个 `NEXT_PUBLIC_*` 会被**内联进构建产物**，改了必须重新 `build`，只重启无效。
> ⚠️ 不要创建任何 `NEXT_PUBLIC_` + 密钥的组合，否则等于把整库权限交给浏览器。

---

## 6. API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/ingest` | 上传 PDF/TXT（multipart，字段 `file`）→ 解析切块入库 |
| POST | `/api/embed` | `{documentId}` 向量化该文档待处理切片（幂等） |
| POST | `/api/retrieve` | `{query, docIds?, topK?}` 检索并精排 |
| POST | `/api/chat` | `{conversationId, question, mode, docIds?}` → SSE 流式回答 |
| POST | `/api/quiz` | `{documentId, count, type, topic}` → 题目 JSON + 工具调用日志 |
| POST | `/api/graph` | `{documentId, refresh?}` → 实体关系图（带 `graph_json` 缓存） |
| GET | `/api/documents` | 文档列表（含切片数 / 待向量化数） |
| DELETE | `/api/documents/:id` | 删除文档（连 Storage 文件一起清） |
| GET | `/api/documents/:id/url` | 返回 10 分钟有效的私有桶 signed URL |
| GET/POST | `/api/conversations` | 会话列表 / 新建 |
| PATCH/DELETE | `/api/conversations/:id` | 重命名 / 删除会话 |

错误响应统一为 `{ "error": { "code": "…", "message": "…" } }`，`code` 便于前端分支处理文案。

---

## 7. 团队信息

| 项 | 内容 |
| --- | --- |
| 学校 / 学院 | 重庆科技大学 · 机械与智能学院 |
| 专业 | 机械工程（硕士研究生） |
| 队长 | **李双** · 1838765568@qq.com |
| 队员 | **刘璐** |
| 指导教师 | `【待填写】` |
| 参赛赛道 | `【待填写】` |
| 项目周期 | `【待填写】` |
| 联系方式 | 1838765568@qq.com |

**分工说明（建议按实际情况补充）**

| 成员 | 负责模块 |
| --- | --- |
| 李双 | `【待填写：如 后端 API / RAG 链路 / 部署运维】` |
| 刘璐 | `【待填写：如 前端交互 / 引用溯源 / 文档与答辩材料】` |

---

## 8. 致谢

本项目建立在以下优秀开源项目与免费服务之上：

| 名称 | 用途 |
| --- | --- |
| [Next.js](https://nextjs.org/) | 全栈框架（App Router / Route Handlers） |
| [Vercel AI SDK](https://sdk.vercel.ai/) | `streamText` / `generateText` / `generateObject` / `useChat` |
| [Supabase](https://supabase.com/) + [pgvector](https://github.com/pgvector/pgvector) | 数据库、向量检索、对象存储 |
| [智谱 AI](https://open.bigmodel.cn/) | `glm-4.7-flash` / `embedding-3` / `bge-reranker-large` |
| [pdf-parse](https://gitlab.com/autokent/pdf-parse) + [pdf.js / react-pdf](https://github.com/wojtekmaj/react-pdf) | PDF 文本抽取与原文渲染 |
| [shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS](https://tailwindcss.com/) | UI 组件与样式 |
| [Zustand](https://zustand-demo.pmnd.rs/) | 状态管理 |
| [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) + [rehype-highlight](https://github.com/rehypejs/rehype-highlight) | Markdown 渲染与代码高亮 |
| [sonner](https://sonner.emilkowal.ski/) · [lucide](https://lucide.dev/) | Toast 与图标 |
| [Geist 字体](https://github.com/vercel/geist-font) | 自托管 latin 子集（OFL-1.1，见 `app/fonts/NOTICE.md`） |

---

## 附录 A：接口自测（curl）

```bash
# 上传（返回 documentId / chunkCount / pageCount）
curl -X POST http://localhost:3000/api/ingest -F "file=@./课件.pdf"

# 向量化（返回 {"embedded": N}）
curl -X POST http://localhost:3000/api/embed \
  -H "Content-Type: application/json" -d '{"documentId":"<id>"}'

# 检索（按相关性降序）
curl -X POST http://localhost:3000/api/retrieve \
  -H "Content-Type: application/json" -d '{"query":"什么是梯度下降","topK":4}'

# 流式问答（SSE）
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"<uuid>","question":"什么是梯度下降","mode":"precise"}'
```

> Windows PowerShell 建议把 JSON 写进文件后用 `--data-binary "@body.json"`，避免引号转义问题。

## 附录 B：数据库校验 SQL

```sql
-- 每份文档切成多少块、页码范围
select document_id, count(*) as chunks, min(page_num) as first_page, max(page_num) as last_page
from public.chunks group by document_id;

-- 是否还有未向量化的切片；维度是否统一为 1024
select count(*) filter (where embedding is null) as pending, count(*) as total
from public.chunks where document_id = '<documentId>';

select distinct vector_dims(embedding) as dims
from public.chunks where document_id = '<documentId>' and embedding is not null;
```

## 附录 C：已知限制

| 限制 | 说明 |
| --- | --- |
| 扫描版 PDF | 无文本层，`pdf-parse` 抽不出文字 → 返回 422，需 OCR |
| 会话历史不回填 | 刷新后聊天区为空（会话 id 保留，后续提问仍追加到同一会话） |
| 输出兜底滞后 | 敏感词在 `onFinish` 才检出，此时内容已流式下发；防线实际作用于落库与日志 |
| 注入检测是规则匹配 | 拆字、拼音等变形可能绕过，兜底依赖 precise 模式「只依据 context」策略 |
| 无用户体系 | 单用户演示态；表结构已按 `conversation_id` / `document_id` 设计，接入 Auth + RLS 即可多租户 |

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 部署清单（VPS / Vercel / Render / Codespaces）+ 冒烟测试四步 + 故障排查 |
| [`docs/REVIEW.md`](docs/REVIEW.md) | 评审体验说明：是否需登录、如何发账号、5 分钟路线、演示前预热 |
| [`docs/tech-doc-outline.md`](docs/tech-doc-outline.md) | 参赛技术文档逐章要点 + 待补实验数据 + 必拍截图清单 |
