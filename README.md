# AIWeb
AI Web Development Challenge

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 部署清单：Supabase 迁移 → Storage bucket → Vercel 环境变量 → 冒烟测试（四步） |
| [`docs/REVIEW.md`](docs/REVIEW.md) | 评审体验说明：是否需要登录、如何发放评审账号、5 分钟体验路线、演示前预热清单 |
| 本 README（下文） | 本地开发：数据库初始化、Storage 配置、各接口 curl 自测与校验 SQL |

## 数据库初始化（Supabase）

> 上传入库与 RAG 检索依赖这些表与函数，请先执行本步骤。

1. 登录 Supabase 控制台，进入本项目 → 左侧 **SQL Editor** → **New query**。
2. 打开仓库内 `supabase/migrations/001_init.sql`，**全选复制**后粘贴到编辑器。
3. 点击 **Run**（快捷键 `Ctrl + Enter`），成功时提示 `Success. No rows returned`。
4. 执行结果自检：
   - **Table Editor**：存在 `documents`、`chunks`、`conversations`、`messages` 四张表；
   - **Database → Functions**：存在 `match_documents`，参数为 `query_embedding vector(1024)`、`doc_ids uuid[]`、`match_count integer`；
   - **Database → Extensions**：`vector` 已处于启用状态。
5. 若报错 `extension "vector" is not available`：先到 **Database → Extensions** 搜索 `vector` 启用，再重新执行脚本。
6. 脚本使用 `if not exists` / `create or replace`，**可重复执行**；但它不会修改已存在表的结构，后续字段变更请新增迁移文件。

## 环境变量

复制 `.env.example` 为 `.env.local` 并填写：

| 变量 | 说明 |
| --- | --- |
| `ZHIPU_API_KEY` | 智谱开放平台 API Key，LLM / Embedding / Rerank 共用同一个 Key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目地址，形如 `https://xxxxxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端专用密钥，**绝不能加 `NEXT_PUBLIC_` 前缀** |

> 本地 Node 未加入 PATH 时，先执行：
> `$env:PATH = "C:\Users\Lynn Li\.workbuddy\binaries\node\versions\22.22.2-6;" + $env:PATH`

## Supabase Storage 配置（上传接口依赖）

`POST /api/ingest` 会把原始文件写入 bucket `documents`，**需要手动创建一次**：

1. Supabase Dashboard → **Storage** → **New bucket**
2. Name 填 `documents`，**不要**勾选 Public bucket，点击 Save
3. 不需要建访问策略：服务端使用 service_role，读写自动绕过 RLS

> 忘记创建时接口返回 `{"error":{"code":"STORAGE_BUCKET_MISSING", …}}`，其中包含上述步骤提示。

## 接口自测：文档上传入库

```bash
# macOS / Linux / Git Bash
curl -X POST http://localhost:3000/api/ingest -F "file=@./课件.pdf"
```

```powershell
# Windows PowerShell
curl.exe -X POST http://localhost:3000/api/ingest -F "file=@D:\path\to\课件.pdf"
```

成功响应：

```json
{ "documentId": "6f1c…", "chunkCount": 11, "pageCount": 5 }
```

失败响应统一为 `{ "error": { "code": "…", "message": "…" } }`，状态码：400 入参错误 / 413 超体积 / 415 类型不支持 / 422 解析失败或空文本 / 500 存储或数据库失败。

### 落库校验（SQL Editor）

```sql
-- 每份文档切成多少块、页码范围
select document_id, count(*) as chunks, min(page_num) as first_page, max(page_num) as last_page
from public.chunks group by document_id order by last_page desc;

-- 逐块核对页码与内容（把 <documentId> 换成上一步返回值）
select page_num, token_count, left(content, 50) as preview
from public.chunks
where document_id = '<documentId>'
order by page_num, id;
```

> 已知限制：Vercel Serverless 请求体上限为 4.5MB，公网部署时超过该体积的 PDF 需改为 Storage 直传；本接口的 20MB 上限适用于本地与自托管。

## 接口自测：向量化

上传成功后调用（`documentId` 用上一步返回值）：

```bash
# macOS / Linux / Git Bash
curl -X POST http://localhost:3000/api/embed \
  -H "Content-Type: application/json" \
  -d '{"documentId":"6f1c…"}'
```

```powershell
# Windows PowerShell（单引号包住 JSON，避免转义）
curl.exe -X POST http://localhost:3000/api/embed -H "Content-Type: application/json" -d '{ "documentId": "6f1c…" }'
```

成功响应：`{ "embedded": 11 }`（本次实际向量化条数）。

- 幂等：只处理 `embedding IS NULL` 的行，重复调用会继续补齐；切片已全部完成时返回 `{"embedded":0}`。
- 失败：`500` + `error.failedChunkIds`，便于定位到具体切片重跑。
- 大文档可能超过函数 60s 上限，直接再调一次即可续做。

### 校验向量维度（SQL Editor）

```sql
-- 1) 是否还有未向量化的切片
select count(*) filter (where embedding is null) as pending,
       count(*)                                  as total
from public.chunks
where document_id = '<documentId>';

-- 2) 维度必须全部是 1024（vector_dims 为 pgvector 内置函数）
select distinct vector_dims(embedding) as dims
from public.chunks
where document_id = '<documentId>' and embedding is not null;

-- 3) 抽样看相似度是否可用（与第一个切片的余弦距离）
select id, page_num, round((embedding <=> (select embedding from public.chunks where document_id = '<documentId>' limit 1))::numeric, 4) as cos_distance
from public.chunks
where document_id = '<documentId>'
order by cos_distance
limit 5;
```

## 接口自测：检索

```bash
# macOS / Linux / Git Bash
curl -X POST http://localhost:3000/api/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query":"什么是梯度下降","topK":4}'
```

```powershell
# Windows PowerShell
curl.exe -X POST http://localhost:3000/api/retrieve -H "Content-Type: application/json" -d '{ "query": "什么是梯度下降", "topK": 4 }'
```

返回（数组，按相关性降序）：

```json
[
  {
    "chunkId": "…",
    "documentId": "…",
    "docTitle": "机器学习讲义",
    "content": "梯度下降是一种迭代优化算法……",
    "pageNum": 6,
    "score": 0.92,
    "vectorScore": 0.78,
    "reranked": true
  }
]
```

**链路**：`embedQuery` → `match_documents`（向量召回 Top-8）→ `bge-reranker-large` 精排取 Top-K（默认 4）。

**降级**：改错 `lib/rerank.ts` 的 `RERANK_URL` 后调用，接口不会失败，只会在服务端日志打印
`[rerank] 精排不可用，降级为向量检索原顺序：…`，返回项 `reranked: false` 且 `score` 等于 `vectorScore`。

## 检索质量调试页

浏览器打开 <http://localhost:3000/debug>（页首标注「检索质量调试页 · 非面向用户」）：

- 输入问题 → 调用 `/api/retrieve` → 表格展示 Top-4：文档名 / 页码 / 前 120 字摘要 / 分数
- 分数着色：≥0.70 绿色（高）、0.40–0.69 黄色（中）、<0.40 灰色（低）
- 右上角标记本次是否「已精排」或「精排降级」

## 接口自测：流式问答

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"6f1c1f7e-0f6a-4a1b-9c2d-3e4f5a6b7c8d","question":"什么是梯度下降","mode":"precise"}'
```

```powershell
# Windows PowerShell：把 JSON 写进 body.json 再用 --data-binary，避免引号转义踩坑
curl.exe -N -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" --data-binary "@body.json"
```

响应为 SSE（`text/event-stream`），逐帧如：

```text
data: {"type":"start"}
data: {"type":"text-delta","id":"0","delta":"梯度下降是"}
data: {"type":"finish"}
```

行为说明：

- `conversationId` 不存在时**自动新建会话**（标题取问题前 30 字），已存在则不改标题。
- 用户消息在流开始前落库，AI 回复在流结束后落库；`citations` 只保留回答里**真正引用到的角标**（如只用了 `[1][3]` 就只存这两条）。
- `mode` 缺省按 `precise` 处理（宁可不答也不编造）。
- 流已开始后若模型报错，无法再改 HTTP 状态码，错误会以 SSE `error` 帧下发并打印在服务端日志。

> 注意：`NEXT_PUBLIC_SUPABASE_URL` 会在 `next build` 时被内联进产物，**改了它必须重新构建**；`ZHIPU_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 是运行时读取，改完重启即可。

## PDF 原文预览（react-pdf）

- **worker**：`public/pdf.worker.min.mjs` 由 `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` 复制而来，`PdfViewer` 里通过 `pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"` 指定（不走 CDN，离线可用）。
  **升级 `pdfjs-dist` / `react-pdf` 后必须重新复制该文件**，否则浏览器控制台会报 `API version does not match Worker version`，PDF 白屏。
- **必须动态引入**：`components/viewer/PdfViewer.tsx` 由 `ChatWorkspace` 用 `next/dynamic({ ssr: false })` 加载。pdf.js 依赖 `window`/`document`，SSR 直接渲染会在构建或首屏报错。
- **原文地址**：`GET /api/documents/:documentId/url` 返回 10 分钟有效的 signed URL（桶非公开，客户端不能直连）。依赖 Storage 桶 `documents` 已按上文创建。
- **定位策略**：点击角标/来源卡片 → 切页 → 逐级用片段前缀（24/16/12/8/6 字）在文本层匹配并加 `<mark>`；全部匹配不到时只跳页不报错。
