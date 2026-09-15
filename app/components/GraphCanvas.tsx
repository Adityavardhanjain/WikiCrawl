'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import { Sigma } from 'sigma';
import type { CrawlResult, WikiNode } from '@/types/graph';
import { getCommunityColor, getNodeSize } from '@/lib/graphAnalysis';

interface GraphCanvasProps {
  data: CrawlResult;
  colorMode: 'community' | 'depth';
  onNodeClick: (node: WikiNode) => void;
  focusedNode: string | null;
}

export function GraphCanvas({
  data,
  colorMode,
  onNodeClick,
  focusedNode,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef(new Graph({ type: 'directed', multi: false }));
  const sigmaRef = useRef<Sigma | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const dataRef = useRef(data);
  const [hoveredNode, setHoveredNode] = useState<WikiNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const focusedNodeRef = useRef(focusedNode);
  const hoveredNodeRef = useRef<string | null>(null);

  dataRef.current = data;

  const maxDepth = useMemo(() => {
    const depths = data.nodes.map((n) => n.depth).filter((d) => d >= 0);
    return Math.max(...depths, 1);
  }, [data.nodes]);

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
    focusedNodeRef.current = focusedNode;
    sigmaRef.current?.refresh();
  }, [focusedNode, onNodeClick]);

  useEffect(() => {
    if (!containerRef.current) return;

    const graph = graphRef.current;
    const sigma = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelFont: 'var(--font-display)',
      labelSize: 12,
      labelColor: { color: '#e2e8f0' },
      labelWeight: '600',
      defaultEdgeColor: 'rgba(148, 163, 184, 0.2)',
      defaultNodeColor: '#67e8f9',
      minCameraRatio: 0.22,
      maxCameraRatio: 4,
      hideLabelsOnMove: true,
      hideEdgesOnMove: false,
      labelRenderedSizeThreshold: 12,
      nodeReducer: (node, nodeAttributes) => {
        const focusId = focusedNodeRef.current;
        const hoverId = hoveredNodeRef.current;
        const neighbors = focusId && graph.hasNode(focusId) ? new Set(graph.neighbors(focusId)) : null;
        const hoverNeighbors = hoverId && graph.hasNode(hoverId) ? new Set(graph.neighbors(hoverId)) : null;
        const isRoot = node === dataRef.current.seedId;
        const isFocus = node === focusId;
        const isNeighbor = neighbors?.has(node) ?? false;
        const isHover = node === hoverId;
        const isHoverNeighbor = hoverNeighbors?.has(node) ?? false;
        const nodeData = graph.getNodeAttributes(node).raw as WikiNode;

        if (isRoot) {
          return {
            ...nodeAttributes,
            size: (Number(nodeAttributes.size) || 10) + 4,
            color: '#f08a70',
            label: nodeData.title,
            forceLabel: true,
            zIndex: 10,
          };
        }

        if (focusId && !isFocus && !isNeighbor) {
          return {
            ...nodeAttributes,
            size: Math.max(5, (Number(nodeAttributes.size) || 8) * 0.76),
            color: 'rgba(100, 116, 139, 0.24)',
            label: '',
            forceLabel: false,
            zIndex: 1,
          };
        }

        if (isFocus) {
          return {
            ...nodeAttributes,
            size: (Number(nodeAttributes.size) || 8) + 3,
            color: '#f4f1ea',
            label: nodeData.title,
            forceLabel: true,
            zIndex: 8,
          };
        }

        if (isNeighbor) {
          return {
            ...nodeAttributes,
            size: (Number(nodeAttributes.size) || 8) + 1.5,
            color: '#72c9c0',
            label: '',
            forceLabel: false,
            zIndex: 5,
          };
        }

        if (isHover) {
          return {
            ...nodeAttributes,
            size: (Number(nodeAttributes.size) || 8) + 2,
            color: '#f7c59f',
            label: nodeData.title,
            forceLabel: true,
            zIndex: 6,
          };
        }

        if (isHoverNeighbor) {
          return {
            ...nodeAttributes,
            color: '#9adbd3',
            label: '',
            forceLabel: false,
          };
        }

        return {
          ...nodeAttributes,
          label: '',
          forceLabel: false,
        };
      },
      edgeReducer: (edge, edgeAttributes) => {
        const focusId = focusedNodeRef.current;
        const hoverId = hoveredNodeRef.current;
        const [source, target] = graph.extremities(edge);
        const isFocusedEdge = focusId === source || focusId === target;
        const isHoveredEdge = hoverId === source || hoverId === target;

        if (isFocusedEdge) {
          return { ...edgeAttributes, color: 'rgba(125, 211, 252, 0.8)', size: 1.6 };
        }

        if (isHoveredEdge) {
          return { ...edgeAttributes, color: 'rgba(125, 211, 252, 0.45)', size: 1.1 };
        }

        if (focusId) {
          return { ...edgeAttributes, color: 'rgba(148, 163, 184, 0.08)', size: 0.45 };
        }

        return { ...edgeAttributes, color: 'rgba(148, 163, 184, 0.22)', size: 0.8 };
      },
    });

    sigmaRef.current = sigma;

    sigma.on('enterNode', ({ node }) => {
      const nodeData = graph.getNodeAttributes(node).raw as WikiNode;
      hoveredNodeRef.current = node;
      setHoveredNode(nodeData);
      sigma.refresh();
      sigma.getContainer().style.cursor = 'pointer';
    });

    sigma.on('leaveNode', () => {
      hoveredNodeRef.current = null;
      setHoveredNode(null);
      sigma.refresh();
      sigma.getContainer().style.cursor = 'default';
    });

    sigma.on('clickNode', ({ node }) => {
      const nodeData = graph.getNodeAttributes(node).raw as WikiNode;
      onNodeClickRef.current(nodeData);
    });

    const container = sigma.getContainer();
    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      setTooltipPos({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    container.addEventListener('mousemove', handleMouseMove);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      sigma.kill();
      sigmaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    graph.clear();
    hoveredNodeRef.current = null;
    setHoveredNode(null);

    const positions = getKnowledgeMapPositions(data.nodes, data.edges, data.seedId);
    for (const node of data.nodes) {
      const graphPosition = positions.get(node.id) ?? { x: 0, y: 0 };
      const isSeed = node.id === data.seedId;
      const size = getNodeSize(node.pagerank, 5, 16) * (isSeed ? 1.3 : 1);
      const color = isSeed ? '#f08a70' : colorMode === 'community'
        ? getCommunityColor(node.communityId, Math.max(data.communities.length, 1))
        : getDepthColor(node.depth, maxDepth);

      graph.addNode(node.id, {
        x: graphPosition.x,
        y: graphPosition.y,
        size,
        color,
        label: isSeed ? node.title : '',
        raw: node,
        isSeed,
      });
    }

    for (const edge of data.edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target) && !graph.hasEdge(edge.source, edge.target)) {
        graph.addEdge(edge.source, edge.target, {
          size: 0.8,
          color: 'rgba(148, 163, 184, 0.22)',
        });
      }
    }

    sigmaRef.current?.refresh();
    sigmaRef.current?.getCamera().animatedReset({ duration: 420 });
  }, [colorMode, data, maxDepth]);

  useEffect(() => {
    if (!sigmaRef.current || !focusedNode) return;

    const camera = sigmaRef.current.getCamera();
    const pos = graphRef.current.hasNode(focusedNode)
      ? graphRef.current.getNodeAttributes(focusedNode)
      : null;

    if (pos) {
      camera.animate({ x: pos.x, y: pos.y }, { duration: 300 });
    }
  }, [focusedNode]);

  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [focusedNode, colorMode]);

  const resetLayout = () => {
    const graph = graphRef.current;
    const positions = getKnowledgeMapPositions(data.nodes, data.edges, data.seedId);

    for (const node of data.nodes) {
      const pos = positions.get(node.id) ?? { x: 0, y: 0 };
      graph.setNodeAttribute(node.id, 'x', pos.x);
      graph.setNodeAttribute(node.id, 'y', pos.y);
    }

    sigmaRef.current?.getCamera().animatedReset({ duration: 260 });
    sigmaRef.current?.refresh();
  };

  return (
    <div ref={containerRef} className="graph-surface w-full h-full relative">
      <div className="absolute top-4 right-4 flex gap-1 graph-overlay rounded-lg p-1 z-10">
        <button className="graph-control" onClick={() => sigmaRef.current?.getCamera().animatedZoom({ duration: 180 })} aria-label="Zoom in">+</button>
        <button className="graph-control" onClick={() => sigmaRef.current?.getCamera().animatedUnzoom({ duration: 180 })} aria-label="Zoom out">-</button>
        <button className="graph-control graph-control-wide" onClick={() => sigmaRef.current?.getCamera().animatedReset({ duration: 220 })}>Fit</button>
        <button className="graph-control graph-control-wide" onClick={resetLayout}>Reset</button>
      </div>

      <div className="absolute top-4 left-4 graph-overlay rounded-xl p-4 text-xs z-10">
        <div className="text-white font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Exploration map
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-full bg-[#f08a70] border border-[#ffd1c2]/70" />
          <span className="text-slate-300">Root</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-full bg-[#72c9c0] border border-[#c7f1eb]/50" />
          <span className="text-slate-300">Connected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-slate-500 border border-slate-300/50" />
          <span className="text-slate-300">Focus</span>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 graph-overlay rounded-xl p-4 text-xs z-10 max-sm:hidden">
        <div className="text-white font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
          Explore
        </div>
        <div className="text-slate-400 space-y-1.5">
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Hover for context
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            Click to focus
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-pink-400" />
            Scroll to zoom
          </p>
        </div>
      </div>

      {hoveredNode && (
        <div
          className="node-tooltip"
          style={{
            left: tooltipPos.x + 15,
            top: tooltipPos.y + 15,
          }}
        >
          <h4>{hoveredNode.title}</h4>
          {hoveredNode.extract ? (
            <p>{hoveredNode.extract.slice(0, 200)}...</p>
          ) : (
            <p className="text-gray-400 italic">Click for more info</p>
          )}
          <div className="mt-2 pt-2 border-t border-gray-700 flex gap-4 text-xs">
            <span>Depth: {hoveredNode.depth >= 0 ? hoveredNode.depth : '?'}</span>
            <span>PageRank: {hoveredNode.pagerank.toFixed(4)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function getKnowledgeMapPositions(
  nodes: WikiNode[],
  edges: CrawlResult['edges'],
  seedId: string,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const seed = nodes.find((node) => node.id === seedId) ?? nodes[0];

  if (!seed) return positions;

  const neighbors = new Map<string, Set<string>>();
  for (const node of nodes) neighbors.set(node.id, new Set());
  for (const edge of edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }

  positions.set(seed.id, { x: 0, y: 0 });
  const placed = new Set([seed.id]);
  const byDepth = [...nodes]
    .filter((node) => node.id !== seed.id)
    .sort((a, b) => (a.depth - b.depth) || (b.pagerank - a.pagerank) || a.title.localeCompare(b.title));
  const placedByDepth = new Map<number, number>();

  byDepth.forEach((node, index) => {
    const depth = node.depth >= 0 ? node.depth : 2;
    const siblingIndex = placedByDepth.get(depth) ?? 0;
    placedByDepth.set(depth, siblingIndex + 1);
    const connected = Array.from(neighbors.get(node.id) ?? []).filter((id) => placed.has(id));
    const anchor = connected.length > 0
      ? connected.map((id) => positions.get(id)).find(Boolean) ?? { x: 0, y: 0 }
      : { x: 0, y: 0 };
    const importance = Math.min(Math.max(node.pagerank * 1000, 0), 1);
    const branch = siblingIndex % 2 === 0 ? 1 : -1;
    const lane = Math.floor(siblingIndex / 2);
    const spread = 170 + lane * 135 + importance * 38;
    const angle = branch * (0.42 + (lane % 3) * 0.23) + depth * 0.17 + index * 0.035;

    positions.set(node.id, {
      x: anchor.x + Math.cos(angle) * spread,
      y: anchor.y + Math.sin(angle) * spread,
    });
    placed.add(node.id);
  });

  return positions;
}

function getDepthColor(depth: number, maxDepth: number): string {
  if (depth < 0) return '#94a3b8';
  const ratio = depth / Math.max(maxDepth, 1);
  const hue = 178 - ratio * 22;
  return `hsl(${hue}, 52%, 58%)`;
}
