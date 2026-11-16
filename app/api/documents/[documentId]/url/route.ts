// 文档预览地址接口：为 documents 桶内的原始 PDF 生成短期 signed URL（桶非公开，客户端不能直接取）。
// 说明：documents 表未存 storage_path，这里按 `${documentId}/` 前缀列出对象取第一个（上传时就是该结构）。

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildApiError } from "@/lib/api-error";
import type { ApiErrorBody, ApiErrorCode } from "@/types";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_BUCKET = "documents";

/** signed URL 有效期（秒）：足够翻页，又不至于长期泄露 */
const EXPIRES_IN = 60 * 10;

function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
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

  const { data: objects, error: listError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(documentId, { limit: 1 });

  if (listError) {
    return fail("STORAGE_SIGN_FAILED", `读取文档目录失败：${listError.message}`, 500);
  }

  const object = objects?.[0];
  if (!object) {
    return fail("DOCUMENT_NOT_FOUND", "Storage 中找不到该文档的原始文件", 404);
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(`${documentId}/${object.name}`, EXPIRES_IN);

  if (signError || !signed?.signedUrl) {
    return fail(
      "STORAGE_SIGN_FAILED",
      `生成预览链接失败：${signError?.message ?? "未返回 signedUrl"}`,
      500,
    );
  }

  return NextResponse.json({ url: signed.signedUrl, expiresIn: EXPIRES_IN });
}
