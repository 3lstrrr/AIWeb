// 单个文档接口：DELETE 删除数据库记录（chunks 级联）并清理 Storage 中的原始文件。

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildApiError } from "@/lib/api-error";
import type { ApiErrorBody, ApiErrorCode } from "@/types";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_BUCKET = "documents";

type RouteContext = { params: Promise<{ documentId: string }> };

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  if (!UUID_PATTERN.test(documentId)) {
    return fail("INVALID_BODY", "documentId 不是合法 UUID", 400);
  }

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  // 先删 Storage 文件（路径结构为 ${documentId}/${安全文件名}）；失败不阻断数据库清理
  const { data: objects } = await supabase.storage.from(STORAGE_BUCKET).list(documentId);
  const paths = (objects ?? []).map((object) => `${documentId}/${object.name}`);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    if (removeError) {
      console.warn(`[documents] 清理 Storage 文件失败（继续删库）：${removeError.message}`);
    }
  }

  const { error } = await supabase.from("documents").delete().eq("id", documentId);
  if (error) {
    return fail("DB_UPDATE_FAILED", `删除文档失败：${error.message}`, 500);
  }

  return NextResponse.json({ deleted: true });
}
