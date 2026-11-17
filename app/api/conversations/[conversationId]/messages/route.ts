// 会话消息列表：刷新页面或切换会话后，前端用它回填历史消息与引用。

import { NextResponse } from "next/server";
import { buildApiError } from "@/lib/api-error";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ApiErrorBody, ApiErrorCode, Citation, MessageRole } from "@/types";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 单次最多回填的消息条数，避免超长会话把页面拖慢 */
const MAX_MESSAGES = 200;

type RouteContext = { params: Promise<{ conversationId: string }> };

interface StoredMessage {
  id: string;
  role: MessageRole;
  content: string;
  citations: Citation[] | null;
  created_at: string;
}

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(_request: Request, context: RouteContext) {
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

  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, citations, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);

  if (error) {
    return fail("DB_QUERY_FAILED", `读取历史消息失败：${error.message}`, 500);
  }

  const messages = (data ?? []) as StoredMessage[];
  return NextResponse.json({ messages });
}
