-- 001_init.sql —— 智学 · AI 课程答疑助手 初始数据库结构
-- 在 Supabase SQL Editor 中整体执行；脚本使用 if not exists / create or replace，可安全重复执行。
-- 向量维度固定 1024（智谱 embedding-3），与 lib/embedding.ts 的 EMBED_DIM 保持一致。

-- pgvector 扩展（Supabase 若已通过 Dashboard 启用，此句为空操作）
create extension if not exists vector;

-- Supabase 的 vector 扩展可能装在 extensions schema，显式纳入 search_path，保证 vector(1024) 能解析
set search_path = public, extensions;

-- ─────────────────────────── 文档表 ───────────────────────────
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  file_type   text        not null default 'pdf',
  file_size   bigint      not null default 0,
  page_count  integer     not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.documents is '知识库文档（课件 / 文献 PDF）';

-- ─────────────────────────── 切片表 ───────────────────────────
create table if not exists public.chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid        not null references public.documents (id) on delete cascade,
  content      text        not null,
  page_num     integer     not null default 1,
  embedding    vector(1024),
  token_count  integer     not null default 0
);

comment on table public.chunks is '文档切片；embedding 为 1024 维向量，入库前可为 null';

-- 按文档过滤检索时用到
create index if not exists chunks_document_id_idx on public.chunks (document_id);

-- 余弦距离的 ivfflat 索引（lists 需按数据量调优：约 rows/1000，1 万条以内 100 足够）
create index if not exists chunks_embedding_idx
  on public.chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ─────────────────────────── 会话表 ───────────────────────────
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null default '新对话',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.conversations is '问答会话；updated_at 由应用在追加消息时更新';

-- ─────────────────────────── 消息表 ───────────────────────────
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.conversations (id) on delete cascade,
  role             text        not null check (role in ('user', 'assistant', 'system')),
  content          text        not null,
  citations        jsonb,
  created_at       timestamptz not null default now()
);

comment on table public.messages is '会话消息；citations 为引用溯源数组（Citation[]）';

-- 会话内按时间顺序拉取历史
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- ─────────────────── 行级安全：仅服务端 service_role 可读写 ───────────────────
-- 本项目所有数据库访问都走服务端 service_role（自动绕过 RLS），
-- 开启 RLS 且不建策略，可防止 anon key 被误用后直接读到课件内容。
alter table public.documents     enable row level security;
alter table public.chunks        enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- ─────────────────── 向量检索 RPC ───────────────────
-- query_embedding：问题的 1024 维向量
-- doc_ids：限定检索范围（null 表示全库检索；传空数组则返回 0 行）
-- match_count：返回条数上限
-- score：余弦相似度 = 1 - 余弦距离，越大越相似
create or replace function public.match_documents (
  query_embedding vector(1024),
  doc_ids         uuid[] default null,
  match_count     integer default 5
)
returns table (
  id           uuid,
  document_id  uuid,
  content      text,
  page_num     integer,
  token_count  integer,
  score        double precision
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.page_num,
    c.token_count,
    1 - (c.embedding <=> query_embedding) as score
  from public.chunks c
  where c.embedding is not null
    and (doc_ids is null or c.document_id = any (doc_ids))
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- 向量检索：返回与 query_embedding 最相似的 chunk，支持 doc_ids 过滤；score 为余弦相似度
