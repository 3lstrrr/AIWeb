# 部署清单（Vercel + Supabase）

> 目标：把「智学 · AI 课程答疑助手」部署到 Vercel，并跑通 上传 → 问答 → 引用 → 出题 全链路。
> 全程约 20–30 分钟。带 ☑ 的步骤是**必须完成**，否则线上会报错。

---

## 0. 前置条件

| 项 | 要求 |
| --- | --- |
| 账号 | Supabase、Vercel、智谱开放平台（https://open.bigmodel.cn），三者用同一邮箱即可 |
| 代码 | 仓库已推到 GitHub（`.env.local` 必须**不在**仓库里，`.gitignore` 已含 `.env*`） |
| 运行时 | 本地 Node 20+（本项目在 Node 22 上开发） |
| 额度 | 智谱新账号有免费额度；`glm-4.7-flash` / `embedding-3` / `bge-reranker-large` 均为免费或低计价模型 |

---

## 1. ☑ Supabase 生产库：执行 migration

1. 新建 Project（Region 选 `Southeast Asia (Singapore)`，国内访问较快），记下数据库密码。
2. 左侧 **SQL Editor → New query**，按顺序执行仓库里的两个文件：

   | 顺序 | 文件 | 作用 |
   | --- | --- | --- |
   | ① | `supabase/migrations/001_init.sql` | 建 `documents` / `chunks` / `conversations` / `messages` 四表、`vector(1024)` 列与 ivfflat 索引、`match_documents` RPC |
   | ② | `supabase/migrations/002_add_graph_json.sql` | 给 `documents` 加 `graph_json`（知识图谱缓存） |

   两个脚本都是幂等的（`if not exists` / `create or replace`），重复执行不报错。
   成功提示：`Success. No rows returned`。

3. ☑ 执行后自检：

   - **Table Editor**：存在 `documents`、`chunks`、`conversations`、`messages`
   - **Database → Functions**：存在 `match_documents`
   - **Database → Extensions**：`vector` 已启用
   - **Table Editor → documents → Columns**：存在 `graph_json`（缺了会导致 `/api/graph` 返回 `MIGRATION_REQUIRED`）

4. 若报 `extension "vector" is not available`：先到 **Database → Extensions** 搜索 `vector` 启用，再重跑。

---

## 2. ☑ Storage：创建 `documents` bucket

1. **Storage → New bucket**
2. Name 填 `documents`，**不要**勾 Public bucket，Save。
3. 访问策略：**不需要建任何 policy**。本项目的所有读写都走服务端 `service_role`，它自动绕过 RLS；bucket 保持私有，客户端只通过 `/api/documents/:id/url` 拿到 10 分钟有效的签名地址。

> 仅当你以后要改成「浏览器用 anon key 直传」时才需要 policy，示例（当前**不需要**执行）：
>
> ```sql
> create policy "anon can upload to documents"
> on storage.objects for insert to anon
> with check (bucket_id = 'documents');
> ```

---

## 3. ☑ Vercel：导入仓库并配置环境变量

1. Vercel → **Add New → Project → Import Git Repository**，选中仓库。
2. 配置项保持默认（Framework 自动识别 **Next.js**；Root Directory 为仓库根目录；Build Command `npm run build`）。
3. **Settings → General → Node.js Version** 选 **20.x**（或 22.x）。
4. **Settings → Environment Variables**，逐条添加（Production 与 Preview 都勾上）：

   | 变量 | 必填 | 说明 |
   | --- | --- | --- |
   | `ZHIPU_API_KEY` | ☑ | 智谱 Key，LLM/Embedding/Rerank 共用 |
   | `NEXT_PUBLIC_SUPABASE_URL` | ☑ | `https://xxxx.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | ☑ | service_role secret，**绝不能**加 `NEXT_PUBLIC_` |
   | `NEXT_PUBLIC_SITE_URL` | ☑ 建议 | 线上地址（OG 分享卡片用），如 `https://zhixue.vercel.app` |
   | `BASIC_AUTH_USER` | 可选 | 与下一项同时填写才生效：全站 HTTP Basic 认证 |
   | `BASIC_AUTH_PASSWORD` | 可选 | 评审访问口令，见 `docs/REVIEW.md` |

   ⚠️ **两个高频坑**
   - `NEXT_PUBLIC_*` 是**构建期内联**：改了必须 **Redeploy**（重新构建），只重启不生效。
   - 绝对不要建 `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`——那会把整库权限打进浏览器。

5. 点 **Deploy**。首次构建约 2–4 分钟。

---

## 4. 部署后 1 分钟自检

| 检查 | 期望 |
| --- | --- |
| 打开 `/` | 页面正常，标题为「智学 · AI 课程答疑助手」 |
| 查看页面源码 | 有 `<meta property="og:title">`、`og:image`、`<link rel="icon" href="/icon.svg">` |
| 打开 `/opengraph-image` | 返回 1200×630 的 PNG 卡片 |
| 浏览器控制台 | 无 4xx/5xx 请求（首次进入 `/api/documents`、`/api/conversations` 应 200） |
| `Vercel → Logs` | 无 `CONFIG_MISSING`（有的话说明环境变量没配全或没重新部署） |

---

## 5. ☑ 冒烟测试（四步）

> 若启用了 Basic Auth，浏览器会先弹账号密码框；curl 需要加 `-u 用户名:密码`。
> 已上传过的文档可以跳过第 1 步。

### ① 上传 + 向量化（`/upload`）

- 拖入一份**文本型** PDF（扫描件抽不出文字，会返回 422），等卡片状态 `解析中 → 向量化中 → 就绪`。
- 等价 curl：

  ```bash
  # 上传（返回 documentId / chunkCount / pageCount）
  curl -u "$USER:$PASS" -X POST https://<域名>/api/ingest -F "file=@课件.pdf"

  # 向量化（返回 {"embedded": N}，N 应与 chunkCount 一致）
  curl -u "$USER:$PASS" -X POST https://<域名>/api/embed \
    -H "Content-Type: application/json" -d '{"documentId":"<上一步的 documentId>"}'
  ```

- 期望：`{"documentId":"…","chunkCount":11,"pageCount":5}` → `{"embedded":11}`

### ② 问答 + 引用溯源（`/`）

- 在聊天框提问课件里的概念，例如「什么是梯度下降」。
- 期望：**逐字流式**输出；句末出现 `[1] [2]` 角标；回答下方出现「引用来源」卡片（文档名 · 页码 · 片段摘要）。
- 点击角标 → 右侧查看器跳到对应页并高亮片段（移动端自动展开查看器）。
- 反例校验：切到「精确」模式问一个课件外的问题，应得到标准拒答文案「所上传资料中未找到与该问题直接相关的内容。您可以切换到探索模式尝试获得补充回答。」

### ③ 出题（`/quiz`）

- 选同一份文档、数量 5、题型「单选题」、主题留空 → 开始出题。
- 期望：10–40 秒后出现「思考日志 · N 次工具调用」（`检索原文` + `提交题目`），下方 5 道题。
- 逐题点选 → 提交作答 → 顶部显示 `得分 x/5`，每题展开正确答案、解析与引用标签。

### ④ 知识图谱（侧栏「🕸️ 知识图谱」）

- 选同一份文档 → 生成图谱。
- 期望：10–40 秒出现节点/边；拖动节点跟手，点击节点只高亮相连的边；再次打开秒出（命中 `graph_json` 缓存）。

---

## 6. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `/api/ingest` 返回 413 | Vercel 请求体上限 **4.5 MB**。大课件请改用 Storage 直传，或先在本地压到 4.5 MB 内（本项目接口自身限制是 20 MB，那是自托管场景） |
| 上传后 `chunkCount` 为 0 / 422 | 扫描版 PDF 无文本层，需 OCR；或 PDF 加密 |
| `/api/graph` 返回 `MIGRATION_REQUIRED` | 漏执行 `002_add_graph_json.sql` |
| 检索总是降级（页面显示「精排降级」） | 智谱 rerank 不可用或额度问题，链路已自动降级为向量检索，不影响可用性 |
| 函数超时 / 502 | `/api/quiz`、`/api/graph` 已设 `maxDuration = 120`，需 Vercel **Pro** 才允许 >60s；Hobby 计划下超大文档可能超时，重试或换小文档 |
| 改了环境变量不生效 | `NEXT_PUBLIC_*` 是构建期内联 → 必须 Redeploy |
| 上传成功但聊天查不到 | 忘了调 `/api/embed`（上传页会自动串起来，手工 curl 时需自己调） |

---

## 7. 成本与额度

- 一次「上传 + 向量化」：embedding 按切片计费（免费额度内）。
- 一次问答：1 次 embedding + 1 次 rerank + 1 次 glm-4.7-flash 生成。
- 一次出题：1~2 次检索 + 1 次出题生成（token 较多）。
- 建议线上开启 Basic Auth（见下），避免地址被爬虫/他人刷额度。

---

## 8. 安全检查清单（上线前必看）

- [ ] 仓库里搜不到 `sk-` 开头的真实 Key，`.env.local` 未被提交
- [ ] Vercel 环境变量里没有任何 `NEXT_PUBLIC_` + 密钥的组合
- [ ] Storage bucket `documents` 为**私有**
- [ ] 已决定是否开启 `BASIC_AUTH_USER/PASSWORD`（不开启则任何拿到地址的人都能上传/删除/出题）
- [ ] `/debug` 调试页是否需要在生产暴露（当前是公开页面，可在上线前临时下线该路由或依赖 Basic Auth 保护）

---

## 替代方案：部署到 Render（Vercel 注册不了时）

仓库根目录已提供 `render.yaml` Blueprint，可直接一键创建服务。

### 与 Vercel 的关键差异

| 维度 | Vercel | Render（Free） |
| --- | --- | --- |
| 请求体上限 | **4.5 MB**（大 PDF 会被 413） | **无此限制**，本项目的 20 MB 上限真正生效 ✅ |
| 运行形态 | Serverless 函数，`maxDuration` 生效 | 常驻 Node 服务，`maxDuration` 被忽略，改由平台代理超时决定 |
| 冷启动 | 基本无 | 15 分钟无请求后休眠，**下次访问 30–60 秒**才起来 |
| 资源 | 按函数计 | 512 MB 内存 / 0.1 CPU（免费档） |
| 磁盘 | 无状态 | 无状态（本项目中转都走 Supabase，无影响） |

### 部署步骤

1. Render Dashboard → **New → Blueprint** → 选择 `3lstrrr/AIWeb`（需先授权 GitHub App）。
2. Render 会读取 `render.yaml`，逐个弹出 `sync: false` 的变量，按 `docs/DEPLOYMENT.md` 第 3 节的表填写。
3. **`NEXT_PUBLIC_SITE_URL` 先留空也能部署**，首次成功后服务地址形如 `https://zhixue-xxxx.onrender.com`，把它填回去再 **Manual Deploy → Clear build cache & deploy**（`NEXT_PUBLIC_*` 是构建期内联，必须重新构建）。
4. 首次构建约 3–6 分钟（`npm ci` + `next build`）；失败先看 Build Logs 里是 `npm ci` 还是 `next build`。

### 注意事项

- **冷启动**：评审前 1 分钟自己先打开一次首页把服务唤醒，否则评委第一次要等 30–60 秒。
- **超时**：Render 代理层对单请求有限制（以控制台/文档为准）。`/api/quiz`、`/api/graph` 实测 10–40 秒，正常够用；若遇到 502/超时，把出题数量调小或换更小的文档。
- **内存**：免费档 512 MB。`/api/ingest` 用 pdf-parse 解析大 PDF 时内存会飙，**建议课件控制在 10 MB 以内**。
- **构建**：若 Build 阶段 OOM，把 `render.yaml` 的 `buildCommand` 改成 `npm ci && npx next build`（改用 webpack，内存占用低于 Turbopack）。
- **数据层不变**：Supabase 迁移、Storage bucket、环境变量内容与 Vercel 完全一致，按本文第 1–2 节做即可。
- **冒烟测试不变**：仍按第 5 节四步走，只是域名换成 `https://xxx.onrender.com`。
