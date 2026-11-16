// 文档入库接口：接收 PDF / TXT → 存 Supabase Storage → 解析全文 → 切块 → 写 documents 与 chunks（embedding 暂为 null）。
// 注意：Vercel Serverless 的请求体上限是 4.5MB，超过该体积的 PDF 需改为 Storage 直传（本接口本地/自托管可用 20MB）。

import { NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { PAGE_BREAK, splitIntoChunks } from "@/lib/chunker";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildApiError } from "@/lib/api-error";
import type { ApiErrorBody, ApiErrorCode } from "@/types";

// pdf-parse 依赖 Node API（Buffer / fs），必须跑在 Node 运行时
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const STORAGE_BUCKET = "documents";
const CHUNK_INSERT_BATCH = 100;
const MAX_TOKENS = 512;
const OVERLAP_TOKENS = 64;

type SupportedFileType = "pdf" | "txt";

/** 统一错误响应 */
function fail(code: ApiErrorCode, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json(buildApiError(code, message), { status });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 按扩展名优先、MIME 兜底判断文件类型 */
function detectFileType(file: File): SupportedFileType | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".txt") || file.type === "text/plain") return "txt";
  return null;
}

/** PDF 逐页提取文本，页间用 "\f" 分隔，供 chunker 计算 page_num */
async function extractPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const pages: string[] = [];

  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });

      let lastY: number | null = null;
      let pageText = "";
      for (const item of textContent.items) {
        if (!item.str) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 1) pageText += "\n";
        pageText += item.str;
        lastY = y;
      }

      // 去掉正文中可能出现分页哨兵，避免干扰 page_num 计算
      pages.push(pageText.split(PAGE_BREAK).join(""));
      return pageText;
    },
  });

  return {
    text: pages.join(PAGE_BREAK),
    pageCount: parsed.numpages || pages.length,
  };
}

/** TXT 直接按 UTF-8 解码（不接受 GBK，需调用方先转码） */
function extractTxtText(buffer: Buffer): { text: string; pageCount: number } {
  const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
  return { text, pageCount: 1 };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return fail(
      "INVALID_CONTENT_TYPE",
      "请求必须是 multipart/form-data，文件放在 file 字段",
      400,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return fail(
      "INVALID_CONTENT_TYPE",
      `表单解析失败（${describeError(error)}），请确认字段名为 file 且以文件上传`,
      400,
    );
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return fail("FILE_MISSING", "缺少 file 字段：请以文件形式上传，而不是普通文本字段", 400);
  }
  const file = fileEntry;

  if (file.size === 0) {
    return fail("EMPTY_DOCUMENT", "文件内容为空", 422);
  }
  if (file.size > MAX_FILE_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    return fail("FILE_TOO_LARGE", `文件体积 ${sizeMb}MB 超过 20MB 上限`, 413);
  }

  const fileType = detectFileType(file);
  if (!fileType) {
    return fail("UNSUPPORTED_FILE_TYPE", "仅支持 .pdf 与 .txt 文件", 415);
  }

  // 入参校验通过后再要求配置齐全：缺密钥时给出中文错误，而不是抛裸 500
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return fail("CONFIG_MISSING", describeError(error).trim(), 500);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // ── 解析全文 ──
  let text: string;
  let pageCount: number;
  try {
    const extracted = fileType === "pdf" ? await extractPdfText(buffer) : extractTxtText(buffer);
    text = extracted.text;
    pageCount = extracted.pageCount;
  } catch (error) {
    return fail(
      "PDF_PARSE_FAILED",
      `文件解析失败：${describeError(error)}（若为加密或损坏的 PDF，请先另存后再上传）`,
      422,
    );
  }

  const chunks = splitIntoChunks(text, MAX_TOKENS, OVERLAP_TOKENS);
  if (chunks.length === 0) {
    return fail(
      "EMPTY_DOCUMENT",
      "未能提取到有效文本：可能是扫描版 PDF（需 OCR）或文件只有空白字符",
      422,
    );
  }

  // ── 原始文件入库（先 Storage，再写数据库，失败可回滚）──
  const documentId = crypto.randomUUID();
  const safeName =
    file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-80) || `upload.${fileType}`;
  const storagePath = `${documentId}/${safeName}`;
  const mimeType =
    file.type || (fileType === "pdf" ? "application/pdf" : "text/plain; charset=utf-8");

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    const message = uploadError.message ?? "";
    if (/bucket.*not.*found/i.test(message)) {
      return fail(
        "STORAGE_BUCKET_MISSING",
        `Storage 桶 "${STORAGE_BUCKET}" 不存在：请到 Supabase Dashboard → Storage → New bucket，命名为 ${STORAGE_BUCKET}（不要勾选 Public），保存后重试`,
        500,
      );
    }
    return fail("STORAGE_UPLOAD_FAILED", `原始文件上传失败：${message}`, 500);
  }

  // ── 写文档记录 ──
  const { error: documentError } = await supabase.from("documents").insert({
    id: documentId,
    title: file.name.replace(/\.(pdf|txt)$/i, "") || "未命名文档",
    file_type: fileType,
    file_size: file.size,
    page_count: pageCount,
  });

  if (documentError) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return fail("DB_INSERT_FAILED", `写入 documents 表失败：${documentError.message}`, 500);
  }

  // ── 分批写切片（embedding 留空，P3 向量化时回填）──
  for (let offset = 0; offset < chunks.length; offset += CHUNK_INSERT_BATCH) {
    const rows = chunks.slice(offset, offset + CHUNK_INSERT_BATCH).map((chunk) => ({
      document_id: documentId,
      content: chunk.content,
      page_num: chunk.page_num,
      token_count: chunk.token_count,
    }));

    const { error: chunkError } = await supabase.from("chunks").insert(rows);

    if (chunkError) {
      // 回滚：删 documents（chunks 外键级联）与已上传文件，避免留下半成品
      await supabase.from("documents").delete().eq("id", documentId);
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return fail(
        "DB_INSERT_FAILED",
        `写入 chunks 表失败（自第 ${offset + 1} 条起）：${chunkError.message}`,
        500,
      );
    }
  }

  return NextResponse.json({ documentId, chunkCount: chunks.length, pageCount });
}
