// 会话集合接口：GET 列表（支持按标题搜索）、POST 新建。

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildApiError } from "@/lib/api-error";
import type { ApiErrorBody, ApiErrorCode, Conversation } from "@/types";

export const runtime = "nodejs";

/** 单次最多返回的会话数 */
const LIST_LIMIT = 50;

/** 新建会话的默认标题 */
const DEFAULT_TITLE = "新对话";

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: Request) {
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  const { searchParams } = new URL(request.url);
  const keyword = (searchParams.get("q") ?? "").trim();

  let query = supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);

  // 按标题模糊搜索（ilike 对中文按子串匹配）
  if (keyword) query = query.ilike("title", `%${keyword}%`);

  const { data, error } = await query;
  if (error) {
    return fail("DB_QUERY_FAILED", `读取会话列表失败：${error.message}`, 500);
  }

  return NextResponse.json({ conversations: (data ?? []) as Conversation[] });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const title =
    typeof body === "object" && body !== null && typeof (body as { title?: unknown }).title === "string"
      ? ((body as { title: string }).title.trim() || DEFAULT_TITLE)
      : DEFAULT_TITLE;

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({ title: title.slice(0, 60) })
    .select("id, title, created_at, updated_at")
    .single();

  if (error) {
    return fail("DB_INSERT_FAILED", `创建会话失败：${error.message}`, 500);
  }

  return NextResponse.json({ conversation: data as Conversation });
}
