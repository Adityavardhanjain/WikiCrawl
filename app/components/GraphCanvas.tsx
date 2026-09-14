'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import { Sigma } from 'sigma';
import type { CrawlResult, WikiNode } from '@/types/graph';
import { getCommunityColor, getNodeSize } from '@/lib/graphAnalysis';

interface GraphCanvasProps {
  data: CrawlResult;
  colorMode: 'community' | 'depth';
  onNodeClick: (node: WikiNode) => void;
  onPathSelect: (from: string, to: string) => void;
  selectedPath: string[] | null;
  focusedNode: string | null;
  onExpandNode?: (nodeId: string) => void;
}

export function GraphCanvas({
  data,
  colorMode,
  onNodeClick,
  onPathSelect,
  selectedPath,
  focusedNode,
  onExpandNode,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [hoveredNode, setHoveredNode] = useState<WikiNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const firstSelectedNodeRef = useRef<string | null>(null);

  const maxDepth = useMemo(() => {
    const depths = data.nodes.map(n => n.depth).filter(d => d >= 0);
    return Math.max(...depths, 1);
  }, [data.nodes]);

  // Build graph from data
  const graph = useMemo(() => {
    const g = new Graph({ type: 'directed', multi: false });

    for (const node of data.nodes) {
      const pos = data.positions[node.id] || { x: 0, y: 0 };
      const isSeed = node.id === data.seedId;
      
      g.addNode(node.id, {
        label: node.title,
        x: pos.x,
        y: pos.y,
        size: getNodeSize(node.pagerank) * (isSeed ? 1.5 : 1),
        color: isSeed ? '#FFD700' : colorMode === 'community' 
          ? getCommunityColor(node.communityId, data.communities.length)
          : getDepthColor(node.depth, maxDepth),
        raw: node,
        isSeed,
      });
    }

    for (const edge of data.edges) {
      if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
        try {
          g.addEdge(edge.source, edge.target, {
            size: 1,
            color: 'rgba(255, 255, 255, 0.2)',
          });
        } catch (e) {
          // Edge already exists
        }
      }
    }

    return g;
  }, [data, colorMode, maxDepth]);

  // Initialize Sigma
  useEffect(() => {
    if (!containerRef.current || sigmaRef.current) return;

    const sigma = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelFont: 'Arial',
      labelSize: 12,
      labelColor: { color: '#ffffff' },
      defaultEdgeColor: 'rgba(255, 255, 255, 0.2)',
      defaultNodeColor: '#4ECDC4',
      minCameraRatio: 0.5,
      maxCameraRatio: 2,
      hideLabelsOnMove: true,
      hideEdgesOnMove: true,
      labelRenderedSizeThreshold: 8,
    });

    sigmaRef.current = sigma;

    // Mouse events
    sigma.on('enterNode', ({ node }) => {
      const nodeData = graph.getNodeAttributes(node).raw as WikiNode;
      setHoveredNode(nodeData);
      sigma.getContainer().style.cursor = 'pointer';
    });

    sigma.on('leaveNode', () => {
      setHoveredNode(null);
      sigma.getContainer().style.cursor = 'default';
    });

    sigma.on('clickNode', ({ node }) => {
      const nodeData = graph.getNodeAttributes(node).raw as WikiNode;
      const currentFirstSelectedNode = firstSelectedNodeRef.current;
      
      if (currentFirstSelectedNode && currentFirstSelectedNode !== node) {
        // Second click - find path
        onPathSelect(currentFirstSelectedNode, node);
        firstSelectedNodeRef.current = null;
      } else {
        // First click
        onNodeClick(nodeData);
        firstSelectedNodeRef.current = node;
      }
    });

    // Mouse position for tooltip
    const container = sigma.getContainer();
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    container.addEventListener('mousemove', handleMouseMove);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [graph, onNodeClick, onPathSelect]);

  // Update colors when colorMode changes
  useEffect(() => {
    if (!sigmaRef.current) return;

    graph.forEachNode((node, attrs) => {
      const nodeData = attrs.raw as WikiNode;
      const isSeed = node === data.seedId;
      
      graph.setNodeAttribute(node, 'color', isSeed ? '#FFD700' : 
        colorMode === 'community' 
          ? getCommunityColor(nodeData.communityId, data.communities.length)
          : getDepthColor(nodeData.depth, maxDepth)
      );
    });
  }, [colorMode, graph, data.seedId, data.communities.length, maxDepth]);

  // Highlight path when selected
  useEffect(() => {
    if (!sigmaRef.current) return;

    // Reset all edges
    graph.forEachEdge((edge, attrs, source, target) => {
      graph.setEdgeAttribute(edge, 'color', 'rgba(255, 255, 255, 0.2)');
      graph.setEdgeAttribute(edge, 'size', 1);
    });

    if (selectedPath && selectedPath.length > 1) {
      // Highlight path edges
      for (let i = 0; i < selectedPath.length - 1; i++) {
        const from = selectedPath[i];
        const to = selectedPath[i + 1];
        
        if (graph.hasEdge(from, to)) {
          graph.setEdgeAttribute(graph.edge(from, to), 'color', '#FFD700');
          graph.setEdgeAttribute(graph.edge(from, to), 'size', 3);
        }
      }
    }
  }, [selectedPath, graph]);

  // Focus on specific node
  useEffect(() => {
    if (!sigmaRef.current || !focusedNode) return;
    
    const camera = sigmaRef.current.getCamera();
    const pos = data.positions[focusedNode];
    
    if (pos) {
      camera.animate({ x: pos.x, y: pos.y }, { duration: 300 });
    }
  }, [focusedNode, data.positions]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Legend */}
      <div className="absolute top-4 left-4 glass rounded-xl p-4 text-xs z-10">
        <div className="text-white font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Legend
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 border-2 border-white/50 shadow-lg shadow-yellow-500/30" />
          <span className="text-slate-300">Seed Node</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 shadow-lg shadow-cyan-500/20" />
          <span className="text-slate-300">Regular Node</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-1 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full shadow-lg shadow-cyan-500/30" />
          <span className="text-slate-300">Shortest Path</span>
        </div>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 glass rounded-xl p-4 text-xs z-10">
        <div className="text-white font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
          Controls
        </div>
        <div className="text-slate-400 space-y-1.5">
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Click node: View details
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            Click two nodes: Find shortest path
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-pink-400" />
            Scroll: Zoom in/out
          </p>
          <p className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Drag: Pan view
          </p>
        </div>
      </div>

      {/* Tooltip */}
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

function getDepthColor(depth: number, maxDepth: number): string {
  if (depth < 0) return '#888888';
  const ratio = depth / Math.max(maxDepth, 1);
  const hue = (1 - ratio) * 120;
  return `hsl(${hue}, 70%, 50%)`;
}
