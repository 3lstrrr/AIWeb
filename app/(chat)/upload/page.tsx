"use client";

// 文档管理页：拖拽多文件上传 → /api/ingest 解析 → /api/embed 向量化 → 就绪；
// 下方列出知识库文档（名称 / 页数 / 块数 / 状态 / 删除）。所有请求失败统一 toast 中文提示。

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { describeError, readApiError } from "@/lib/api-error";
import { useDocsStore, type DocItem } from "@/stores/docs";
import type { DocumentSummary } from "@/types";

const ACCEPT = ".pdf,.txt";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const STATUS_TEXT: Record<DocItem["status"], string> = {
  parsing: "解析中",
  embedding: "向量化中",
  ready: "就绪",
  failed: "失败",
};

const STATUS_STYLE: Record<DocItem["status"], string> = {
  parsing: "bg-blue-50 text-blue-700 border-blue-200",
  embedding: "bg-amber-50 text-amber-700 border-amber-200",
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

interface IngestResult {
  documentId: string;
  chunkCount: number;
  pageCount: number;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return "-";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 用 XHR 上传以获得真实上传进度（fetch 不支持上传进度回调） */
function ingestFile(file: File, onProgress: (percent: number) => void): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/ingest");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let payload: unknown = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as IngestResult);
      } else {
        reject(new Error(readApiError(payload, `解析失败（HTTP ${xhr.status}）`)));
      }
    };

    xhr.onerror = () => reject(new Error("网络连接失败，请检查网络后重试"));
    xhr.send(formData);
  });
}

export default function UploadPage() {
  const items = useDocsStore((state) => state.items);
  const documents = useDocsStore((state) => state.documents);
  const loading = useDocsStore((state) => state.loading);
  const addItems = useDocsStore((state) => state.addItems);
  const updateItem = useDocsStore((state) => state.updateItem);
  const removeItem = useDocsStore((state) => state.removeItem);
  const setDocuments = useDocsStore((state) => state.setDocuments);
  const setLoading = useDocsStore((state) => state.setLoading);

  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        toast.error(readApiError(payload, "文档列表加载失败"));
        return;
      }
      setDocuments((payload as { documents: DocumentSummary[] }).documents);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLoading(false);
    }
  }, [setDocuments, setLoading]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const accepted = files.filter(
        (file) => /\.(pdf|txt)$/i.test(file.name) && file.size <= MAX_FILE_BYTES,
      );
      const skipped = files.length - accepted.length;
      setNotice(
        skipped > 0 ? `${skipped} 个文件被跳过（仅支持 PDF / TXT，且不超过 20MB）` : null,
      );
      if (accepted.length === 0) return;

      const queue = accepted.map((file) => ({
        file,
        item: {
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          documentId: null,
          title: file.name,
          pageCount: 0,
          chunkCount: 0,
          status: "parsing" as DocItem["status"],
          progress: 0,
        },
      }));

      addItems(queue.map((entry) => entry.item));
      setBusy(true);

      for (const { file, item } of queue) {
        try {
          // 1) 解析入库（上传占用进度前 60%）
          const ingested = await ingestFile(file, (percent) =>
            updateItem(item.key, { progress: Math.round(percent * 0.6) }),
          );
          updateItem(item.key, {
            documentId: ingested.documentId,
            pageCount: ingested.pageCount,
            chunkCount: ingested.chunkCount,
            status: "embedding",
            progress: 65,
          });

          // 2) 向量化
          const embedResponse = await fetch("/api/embed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentId: ingested.documentId }),
          });
          const embedPayload: unknown = await embedResponse.json();
          if (!embedResponse.ok) {
            throw new Error(readApiError(embedPayload, "向量化失败"));
          }

          removeItem(item.key);
          toast.success(`《${item.title}》已就绪`);
          await loadDocuments();
        } catch (error) {
          const message = describeError(error);
          updateItem(item.key, { status: "failed", error: message });
          toast.error(`《${item.title}》处理失败：${message}`);
        }
      }

      setBusy(false);
    },
    [addItems, loadDocuments, removeItem, updateItem],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files);
  };

  const handleDeleteDocument = async (document: DocumentSummary) => {
    if (!window.confirm(`删除《${document.title}》及其全部切片？此操作不可恢复。`)) return;
    try {
      const response = await fetch(`/api/documents/${document.id}`, { method: "DELETE" });
      if (!response.ok) {
        toast.error(readApiError(await response.json(), "删除失败"));
        return;
      }
      toast.success("文档已删除");
      await loadDocuments();
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  return (
    <main className="h-full overflow-y-auto bg-neutral-50">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-6">
        <header className="mb-6 space-y-2 pl-10 md:pl-0">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900">文档管理</h1>
            <Link href="/" className="text-xs text-neutral-500 underline-offset-4 hover:underline">
              ← 返回对话
            </Link>
          </div>
          <p className="text-sm text-neutral-500">
            上传课件 / 文献后自动解析切块并向量化；状态变为「就绪」即可在对话中引用。
          </p>
        </header>

        {notice && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {notice}
          </div>
        )}

        {/* 拖拽上传区 */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? "border-blue-400 bg-blue-50"
              : "border-neutral-300 bg-white hover:border-neutral-400"
          }`}
        >
          <p className="text-sm font-medium text-neutral-700">拖拽 PDF / TXT 到此处，或点击选择文件</p>
          <p className="mt-1 text-xs text-neutral-400">支持多选，单文件不超过 20MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {/* 上传队列 */}
        {items.length > 0 && (
          <section className="mb-6 space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              上传队列{busy ? "（处理中…）" : ""}
            </h2>
            {items.map((item) => (
              <div key={item.key} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-neutral-800">{item.title}</span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[item.status]}`}
                  >
                    {STATUS_TEXT[item.status]}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      item.status === "failed" ? "bg-red-400" : "bg-blue-500"
                    }`}
                    style={{ width: `${item.status === "embedding" ? 80 : item.progress}%` }}
                  />
                </div>
                {item.error && (
                  <p className="mt-1.5 break-all text-[11px] text-red-600">{item.error}</p>
                )}
              </div>
            ))}
          </section>
        )}

        {/* 文档列表 */}
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            知识库文档（{documents.length}）
          </h2>

          {loading && documents.length === 0 && (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-16 animate-pulse rounded-lg bg-neutral-100" />
              ))}
            </div>
          )}

          {!loading && documents.length === 0 && (
            <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-xs text-neutral-400">
              还没有文档。上传一份 PDF 课件试试。
            </p>
          )}

          {documents.map((document) => {
            const ready = document.pendingChunks === 0 && document.chunkCount > 0;
            return (
              <div
                key={document.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-800" title={document.title}>
                    {document.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    {document.pageCount} 页 · {document.chunkCount} 块 · {formatSize(document.fileSize)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      ready
                        ? STATUS_STYLE.ready
                        : document.pendingChunks > 0
                          ? STATUS_STYLE.embedding
                          : STATUS_STYLE.failed
                    }`}
                  >
                    {ready ? "就绪" : document.pendingChunks > 0 ? `待向量化 ${document.pendingChunks}` : "无切片"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteDocument(document)}
                    className="rounded-md border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
