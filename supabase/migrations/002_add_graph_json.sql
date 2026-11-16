-- 002_add_graph_json.sql —— 知识图谱缓存字段
-- 在 Supabase SQL Editor 中执行；使用 if not exists，可重复执行。
-- 结构：{ nodes: [{id, label, type}], edges: [{source, target, relation}] }

alter table public.documents
  add column if not exists graph_json jsonb;

comment on column public.documents.graph_json is
  '知识图谱缓存：{ nodes:[{id,label,type}], edges:[{source,target,relation}] }，由 /api/graph 生成后写入';
