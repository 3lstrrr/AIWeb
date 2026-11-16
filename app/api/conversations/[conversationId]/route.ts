// 单个会话接口：PATCH 重命名、DELETE 删除（messages 由外键级联删除）。

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildApiError } from "@/lib/api-error";
import type { ApiErrorBody, ApiErrorCode, Conversation } from "@/types";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE_LENGTH = 60;

type RouteContext = { params: Promise<{ conversationId: string }> };

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  if (!UUID_PATTERN.test(conversationId)) {
    return fail("INVALID_BODY", "conversationId 不是合法 UUID", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_BODY", "请求体必须是 JSON，例如 { \"title\": \"新标题\" }", 400);
  }

  const rawTitle =
    typeof body === "object" && body !== null ? (body as { title?: unknown }).title : undefined;
  if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
    return fail("INVALID_BODY", "title 不能为空", 400);
  }

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  const { data, error } = await supabase
    .from("conversations")
    .update({ title: rawTitle.trim().slice(0, MAX_TITLE_LENGTH) })
    .eq("id", conversationId)
    .select("id, title, created_at, updated_at")
    .maybeSingle();

  if (error) {
    return fail("DB_UPDATE_FAILED", `重命名失败：${error.message}`, 500);
  }
  if (!data) {
    return fail("DOCUMENT_NOT_FOUND", "会话不存在", 404);
  }

  return NextResponse.json({ conversation: data as Conversation });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  if (!UUID_PATTERN.test(conversationId)) {
    return fail("INVALID_BODY", "conversationId 不是合法 UUID", 400);
  }

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
  if (error) {
    return fail("DB_UPDATE_FAILED", `删除会话失败：${error.message}`, 500);
  }

  return NextResponse.json({ deleted: true });
}
