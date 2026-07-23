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
  const [firstSelectedNode, setFirstSelectedNode] = useState<string | null>(null);
  const [maxDepth, setMaxDepth] = useState(1);

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

  // Calculate max depth
  useEffect(() => {
    const depths = data.nodes.map(n => n.depth).filter(d => d >= 0);
    setMaxDepth(Math.max(...depths, 1));
  }, [data.nodes]);

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
      
      if (firstSelectedNode && firstSelectedNode !== node) {
        // Second click - find path
        onPathSelect(firstSelectedNode, node);
        setFirstSelectedNode(null);
      } else {
        // First click
        onNodeClick(nodeData);
        setFirstSelectedNode(node);
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
  }, [graph, onNodeClick, onPathSelect, firstSelectedNode]);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (camera as any).animate(pos.x, pos.y, { duration: 300 });
    }
  }, [focusedNode, data.positions]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* Legend */}
      <div className="absolute top-4 left-4 bg-gray-900/90 p-3 rounded-lg border border-gray-700 text-xs">
        <div className="text-gray-400 mb-2">Legend</div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 rounded-full bg-yellow-500 border-2 border-yellow-300" />
          <span className="text-gray-300">Seed Node</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 rounded-full bg-cyan-500" />
          <span className="text-gray-300">Regular Node</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-yellow-500" />
          <span className="text-gray-300">Shortest Path</span>
        </div>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 bg-gray-900/90 p-3 rounded-lg border border-gray-700 text-xs">
        <div className="text-gray-400 mb-2">Controls</div>
        <div className="text-gray-300 space-y-1">
          <p>• Click node: View details</p>
          <p>• Click two nodes: Find shortest path</p>
          <p>• Scroll: Zoom in/out</p>
          <p>• Drag: Pan view</p>
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
