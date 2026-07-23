'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import type { CrawlResult, WikiNode } from '@/types/graph';
import { SeedSearch } from './components/SeedSearch';
import { CrawlControls } from './components/CrawlControls';
import { Sidebar } from './components/Sidebar';
import { NodeDetailPanel } from './components/NodeDetailPanel';

// Dynamically import GraphCanvas to avoid SSR issues with WebGL/Sigma
const GraphCanvas = dynamic(
  () => import('./components/GraphCanvas').then(mod => mod.GraphCanvas),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-gray-950">
        <div className="loading-spinner" />
      </div>
    )
  }
);

type ColorMode = 'community' | 'depth';

export default function Home() {
  const queryClient = useQueryClient();
  
  // State
  const [seedTitle, setSeedTitle] = useState('');
  const [depth, setDepth] = useState(2);
  const [maxNodes, setMaxNodes] = useState(200);
  const [colorMode, setColorMode] = useState<ColorMode>('community');
  const [selectedNode, setSelectedNode] = useState<WikiNode | null>(null);
  const [selectedPath, setSelectedPath] = useState<string[] | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  
  // Query for crawl data
  const { data, isLoading, error, refetch } = useQuery<CrawlResult>({
    queryKey: ['crawl', seedTitle, depth, maxNodes],
    queryFn: async () => {
      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedTitle, depth, maxNodes }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to crawl');
      }
      
      return response.json();
    },
    enabled: false,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  // Expand mutation
  const expandMutation = useMutation({
    mutationFn: async (nodeId: string) => {
      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          seedTitle: nodeId, 
          depth: Math.min(depth, 2), // Limit expansion depth
          maxNodes: Math.floor(maxNodes / 2), 
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to expand');
      }
      
      return response.json() as Promise<CrawlResult>;
    },
    onSuccess: (newData) => {
      if (data) {
        // Merge results
        const existingNodeIds = new Set(data.nodes.map(n => n.id));
        const newNodes = newData.nodes.filter(n => !existingNodeIds.has(n.id));
        
        const existingEdges = new Set(data.edges.map(e => `${e.source}|${e.target}`));
        const newEdges = newData.edges.filter(
          e => !existingEdges.has(`${e.source}|${e.target}`)
        );
        
        // Merge positions
        const mergedPositions = { ...data.positions, ...newData.positions };
        
        // Merge communities (recalculate would be better but keeping simple)
        
        const mergedResult: CrawlResult = {
          ...data,
          id: data.id + '-expanded',
          nodes: [...data.nodes, ...newNodes],
          edges: [...data.edges, ...newEdges],
          positions: mergedPositions,
          crawledAt: new Date().toISOString(),
        };
        
        queryClient.setQueryData(['crawl', seedTitle, depth, maxNodes], mergedResult);
      }
    },
  });

  // Handle search
  const handleSearch = useCallback((title: string) => {
    setSeedTitle(title);
    setSelectedNode(null);
    setSelectedPath(null);
    setFocusedNode(null);
    refetch();
  }, [refetch]);

  // Handle node click
  const handleNodeClick = useCallback((node: WikiNode) => {
    setSelectedNode(node);
    setSelectedPath(null);
  }, []);

  // Handle path selection
  const handlePathSelect = useCallback((from: string, to: string) => {
    // Compute shortest path using the data
    if (!data) return;
    
    // Simple BFS for path finding (treating as undirected)
    const adjacency = new Map<string, string[]>();
    for (const node of data.nodes) {
      adjacency.set(node.id, []);
    }
    for (const edge of data.edges) {
      adjacency.get(edge.source)?.push(edge.target);
      adjacency.get(edge.target)?.push(edge.source);
    }
    
    const path = bfs(adjacency, from, to);
    setSelectedPath(path);
    setSelectedNode(null);
  }, [data]);

  // Handle node selection from sidebar
  const handleNodeSelect = useCallback((nodeId: string) => {
    setFocusedNode(nodeId);
    const node = data?.nodes.find(n => n.id === nodeId);
    if (node) {
      setSelectedNode(node);
    }
  }, [data]);

  // Handle community selection
  const handleCommunitySelect = useCallback((communityId: number) => {
    if (!data) return;
    const firstNode = data.nodes.find(n => n.communityId === communityId);
    if (firstNode) {
      setFocusedNode(firstNode.id);
    }
  }, [data]);

  // Handle expand from node
  const handleExpand = useCallback((nodeId: string) => {
    expandMutation.mutate(nodeId);
  }, [expandMutation]);

  // Shareable URL
  useEffect(() => {
    if (data && data.seedId) {
      const url = new URL(window.location.href);
      url.searchParams.set('seed', data.seedId);
      url.searchParams.set('depth', depth.toString());
      url.searchParams.set('nodes', maxNodes.toString());
      window.history.replaceState({}, '', url.toString());
    }
  }, [data, depth, maxNodes]);

  // Load from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const seed = params.get('seed');
    const d = params.get('depth');
    const n = params.get('nodes');
    
    if (seed) {
      setSeedTitle(seed);
      if (d) setDepth(parseInt(d));
      if (n) setMaxNodes(parseInt(n));
      // Trigger search after setting state
      setTimeout(() => {
        refetch();
      }, 100);
    }
  }, [refetch]);

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Header */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Internet Rabbit Hole Generator</h1>
                <p className="text-sm text-gray-400">Explore Wikipedia through interactive graphs</p>
              </div>
            </div>
            
            {/* Color mode toggle */}
            <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setColorMode('community')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  colorMode === 'community'
                    ? 'bg-cyan-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Community
              </button>
              <button
                onClick={() => setColorMode('depth')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  colorMode === 'depth'
                    ? 'bg-cyan-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Depth
              </button>
            </div>
          </div>
          
          {/* Search and controls */}
          <div className="flex gap-6">
            <div className="flex-1">
              <SeedSearch onSearch={handleSearch} isLoading={isLoading} />
            </div>
            <div className="w-96">
              <CrawlControls
                depth={depth}
                maxNodes={maxNodes}
                onDepthChange={setDepth}
                onMaxNodesChange={setMaxNodes}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Graph area */}
        <div className="flex-1 relative bg-gray-950">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-50">
              <div className="text-center">
                <div className="loading-spinner mx-auto mb-4" />
                <p className="text-white text-lg">Crawling Wikipedia...</p>
                <p className="text-gray-400 text-sm mt-2">
                  This may take a few seconds
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center p-8 bg-red-900/20 border border-red-800 rounded-lg max-w-md">
                <svg className="w-12 h-12 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-red-400 text-lg font-medium mb-2">Crawl Failed</p>
                <p className="text-gray-400 text-sm">{String(error)}</p>
                <button
                  onClick={() => refetch()}
                  className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {data && !isLoading && (
            <>
              <GraphCanvas
                data={data}
                colorMode={colorMode}
                onNodeClick={handleNodeClick}
                onPathSelect={handlePathSelect}
                selectedPath={selectedPath}
                focusedNode={focusedNode}
                onExpandNode={handleExpand}
              />
              
              <NodeDetailPanel
                node={selectedNode}
                data={data}
                onClose={() => setSelectedNode(null)}
                onExpand={handleExpand}
                isExpanding={expandMutation.isPending}
              />

              {/* Path info */}
              {selectedPath && selectedPath.length > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/95 border border-gray-700 rounded-lg px-6 py-4 shadow-xl">
                  <div className="flex items-center gap-3">
                    <div className="text-cyan-400 font-medium">
                      Shortest Path ({selectedPath.length - 1} hops)
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedPath.map((nodeId, index) => (
                        <span key={nodeId} className="flex items-center">
                          <span className={`px-2 py-1 rounded text-sm ${
                            index === 0 || index === selectedPath.length - 1
                              ? 'bg-cyan-600 text-white'
                              : 'bg-gray-700 text-gray-300'
                          }`}>
                            {data.nodes.find(n => n.id === nodeId)?.title || nodeId}
                          </span>
                          {index < selectedPath.length - 1 && (
                            <svg className="w-4 h-4 text-gray-500 mx-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => setSelectedPath(null)}
                      className="ml-2 text-gray-400 hover:text-white"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {!data && !isLoading && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <svg className="w-24 h-24 text-gray-700 mx-auto mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <h2 className="text-2xl font-bold text-gray-400 mb-2">
                  Start Your Journey
                </h2>
                <p className="text-gray-500 max-w-md">
                  Enter any Wikipedia article title above and click Explore to discover connections between topics through interactive graph visualization.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        {data && <Sidebar data={data} onNodeSelect={handleNodeSelect} onCommunitySelect={handleCommunitySelect} focusedNode={focusedNode} />}
      </div>
    </div>
  );
}

// Simple BFS implementation
function bfs(adjacency: Map<string, string[]>, start: string, end: string): string[] {
  const queue: string[][] = [[start]];
  const visited = new Set<string>([start]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    if (current === end) {
      return path;
    }

    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return []; // No path found
}
