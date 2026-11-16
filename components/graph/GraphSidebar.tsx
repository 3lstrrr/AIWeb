"use client";

// 知识图谱抽屉：右侧滑出，SVG 力导向布局；节点可拖拽，点击节点高亮与之相连的边。
// 布局为纯前端轻量实现（斥力 + 边引力 + 向心力，迭代 260 次），不引入 reactflow 等重依赖。

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { describeError, readApiError } from "@/lib/api-error";
import { useDocsStore } from "@/stores/docs";
import { useGraphStore } from "@/stores/graph";
import type { DocumentSummary, GraphEdge, GraphNode, KnowledgeGraph } from "@/types";

const CANVAS_WIDTH = 420;
const CANVAS_HEIGHT = 400;
const NODE_RADIUS = 15;
const PADDING = 26;
const LAYOUT_ITERATIONS = 260;

/** 节点类型配色 */
const TYPE_COLORS: Record<string, string> = {
  概念: "#3b82f6",
  方法: "#10b981",
  公式: "#f59e0b",
  结构: "#8b5cf6",
  应用: "#ef4444",
};

function colorOf(type: string): string {
  return TYPE_COLORS[type] ?? "#64748b";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 简易力导向布局：迭代结束后返回每个节点的坐标 */
function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations = LAYOUT_ITERATIONS,
): Record<string, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.3;
  const ids = nodes.map((node) => node.id);
  const points = new Map<string, { x: number; y: number }>();

  nodes.forEach((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    points.set(node.id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });

  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const disp = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));

    // 节点间斥力
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = points.get(ids[i]);
        const b = points.get(ids[j]);
        if (!a || !b) continue;

        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          distance = 0.5;
        }

        const force = (k * k) / distance;
        const ux = dx / distance;
        const uy = dy / distance;
        const da = disp.get(ids[i]);
        const db = disp.get(ids[j]);
        if (da) {
          da.x += ux * force;
          da.y += uy * force;
        }
        if (db) {
          db.x -= ux * force;
          db.y -= uy * force;
        }
      }
    }

    // 边引力（弹簧）
    for (const edge of edges) {
      const a = points.get(edge.source);
      const b = points.get(edge.target);
      if (!a || !b) continue;

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.max(Math.hypot(dx, dy), 0.01);
      const force = (distance * distance) / k;
      const ux = dx / distance;
      const uy = dy / distance;
      const da = disp.get(edge.source);
      const db = disp.get(edge.target);
      if (da) {
        da.x -= ux * force;
        da.y -= uy * force;
      }
      if (db) {
        db.x += ux * force;
        db.y += uy * force;
      }
    }

    // 向心力 + 位移上限（模拟退火）
    const temperature = Math.max(1, (width / 12) * (1 - iteration / iterations));
    for (const id of ids) {
      const point = points.get(id);
      const delta = disp.get(id);
      if (!point || !delta) continue;

      delta.x += (cx - point.x) * 0.02 * k * 0.05;
      delta.y += (cy - point.y) * 0.02 * k * 0.05;

      const length = Math.hypot(delta.x, delta.y) || 1;
      const step = Math.min(length, temperature);
      point.x = clamp(point.x + (delta.x / length) * step, PADDING, width - PADDING);
      point.y = clamp(point.y + (delta.y / length) * step, PADDING, height - PADDING);
    }
  }

  const result: Record<string, { x: number; y: number }> = {};
  for (const [id, point] of points.entries()) {
    result[id] = { x: Math.round(point.x), y: Math.round(point.y) };
  }
  return result;
}

/** 屏幕坐标 → SVG viewBox 坐标 */
function toSvgPoint(svg: SVGSVGElement, event: { clientX: number; clientY: number }) {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return {
    x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
  };
}

export default function GraphSidebar() {
  const open = useGraphStore((state) => state.open);
  const closeDrawer = useGraphStore((state) => state.closeDrawer);
  const documentId = useGraphStore((state) => state.documentId);
  const setDocumentId = useGraphStore((state) => state.setDocumentId);

  const documents = useDocsStore((state) => state.documents);
  const setDocuments = useDocsStore((state) => state.setDocuments);

  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const loadDocuments = useCallback(async () => {
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
    }
  }, [setDocuments]);

  // 打开抽屉时按需加载文档列表
  useEffect(() => {
    if (!open) return;
    if (useDocsStore.getState().documents.length === 0) void loadDocuments();
  }, [open, loadDocuments]);

  // 图变化后重新布局
  useEffect(() => {
    if (!graph) {
      setPositions({});
      return;
    }
    setPositions(computeLayout(graph.nodes, graph.edges, CANVAS_WIDTH, CANVAS_HEIGHT));
    setSelected(null);
  }, [graph]);

  const generate = async (refresh: boolean) => {
    const targetId = useGraphStore.getState().documentId;
    if (!targetId) {
      toast.error("请先选择文档");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: targetId, refresh }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        toast.error(readApiError(payload, "图谱生成失败"));
        return;
      }

      const data = payload as { graph: KnowledgeGraph; cached: boolean };
      setGraph(data.graph);
      toast.success(
        data.cached
          ? `已加载缓存：${data.graph.nodes.length} 个节点`
          : `已生成 ${data.graph.nodes.length} 个节点 / ${data.graph.edges.length} 条关系`,
      );
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleNodePointerDown = (event: ReactPointerEvent<SVGGElement>, id: string) => {
    event.stopPropagation();
    const svg = svgRef.current;
    const current = positions[id];
    if (!svg || !current) return;

    const point = toSvgPoint(svg, event);
    dragging.current = { id, offsetX: current.x - point.x, offsetY: current.y - point.y };
    setSelected(id);
    svg.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragging.current;
    const svg = svgRef.current;
    if (!drag || !svg) return;

    const point = toSvgPoint(svg, event);
    setPositions((previous) => ({
      ...previous,
      [drag.id]: {
        x: clamp(point.x + drag.offsetX, PADDING, CANVAS_WIDTH - PADDING),
        y: clamp(point.y + drag.offsetY, PADDING, CANVAS_HEIGHT - PADDING),
      },
    }));
  };

  const handlePointerUp = () => {
    dragging.current = null;
  };

  const relatedEdges = selected
    ? (graph?.edges ?? []).filter((edge) => edge.source === selected || edge.target === selected)
    : [];
  const relatedNodeIds = new Set<string>();
  for (const edge of relatedEdges) {
    relatedNodeIds.add(edge.source);
    relatedNodeIds.add(edge.target);
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
          onClick={closeDrawer}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-neutral-200 bg-white shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900">知识图谱</h2>
            <p className="text-[11px] text-neutral-400">由课件片段抽取概念与关系 · 点击节点高亮关联</p>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="关闭图谱"
            className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100"
          >
            关闭
          </button>
        </header>

        <div className="space-y-2 border-b border-neutral-200 px-4 py-3">
          <select
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            className="w-full rounded-lg border border-neutral-200 px-2.5 py-2 text-xs text-neutral-800 outline-none focus:border-neutral-400"
          >
            <option value="">请选择文档</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void generate(false)}
              disabled={loading || !documentId}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
            >
              {loading ? "抽取中…" : "生成图谱"}
            </button>
            <button
              type="button"
              onClick={() => void generate(true)}
              disabled={loading || !documentId || !graph}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-40"
            >
              重新生成
            </button>
            {graph && (
              <span className="ml-auto text-[11px] text-neutral-400">
                {graph.nodes.length} 节点 · {graph.edges.length} 关系
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="space-y-2" aria-busy="true">
              <div className="h-48 animate-pulse rounded-xl bg-neutral-100" />
              <p className="text-center text-[11px] text-neutral-400">模型正在抽取实体关系…</p>
            </div>
          )}

          {!loading && !graph && (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-neutral-300 px-6 text-center text-xs leading-relaxed text-neutral-400">
              选择一份文档后点击「生成图谱」。
              <br />
              结果会缓存到数据库，二次打开秒出。
            </div>
          )}

          {!loading && graph && (
            <>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                className="w-full touch-none select-none rounded-xl border border-neutral-100 bg-neutral-50"
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onClick={() => setSelected(null)}
              >
                {graph.edges.map((edge, index) => {
                  const from = positions[edge.source];
                  const to = positions[edge.target];
                  if (!from || !to) return null;

                  const highlighted =
                    selected !== null && (edge.source === selected || edge.target === selected);
                  const dimmed = selected !== null && !highlighted;

                  return (
                    <line
                      key={`${edge.source}-${edge.target}-${index}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={highlighted ? "#2563eb" : "#cbd5e1"}
                      strokeWidth={highlighted ? 2 : 1}
                      opacity={dimmed ? 0.15 : 1}
                    />
                  );
                })}

                {graph.nodes.map((node) => {
                  const point = positions[node.id];
                  if (!point) return null;

                  const isSelected = selected === node.id;
                  const isRelated = relatedNodeIds.has(node.id);
                  const dimmed = selected !== null && !isRelated;

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${point.x}, ${point.y})`}
                      opacity={dimmed ? 0.25 : 1}
                      onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                      onClick={(event) => event.stopPropagation()}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <circle
                        r={isSelected ? NODE_RADIUS + 3 : NODE_RADIUS}
                        fill={colorOf(node.type)}
                        stroke={isSelected ? "#1e3a8a" : "#ffffff"}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                      />
                      <text
                        y={NODE_RADIUS + 13}
                        textAnchor="middle"
                        className="pointer-events-none"
                        fontSize={10.5}
                        fill="#334155"
                      >
                        {node.label.length > 9 ? `${node.label.slice(0, 9)}…` : node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                {Object.entries(TYPE_COLORS).map(([type, color]) => (
                  <span key={type} className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                    {type}
                  </span>
                ))}
              </div>

              {selected && (
                <div className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-relaxed text-neutral-600">
                  <p className="font-medium text-neutral-800">
                    {graph.nodes.find((node) => node.id === selected)?.label}
                  </p>
                  {relatedEdges.length === 0 ? (
                    <p className="mt-0.5 text-neutral-400">该节点暂无关联关系</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {relatedEdges.slice(0, 6).map((edge, index) => (
                        <li key={`${edge.source}-${edge.target}-${index}`}>
                          {graph.nodes.find((node) => node.id === edge.source)?.label}
                          <span className="mx-1 text-neutral-400">{edge.relation}</span>
                          {graph.nodes.find((node) => node.id === edge.target)?.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
