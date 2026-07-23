'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
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
      <div className="flex items-center justify-center h-full bg-gradient-to-b from-gray-950 to-slate-950">
        <div className="loading-spinner" />
      </div>
    )
  }
);

type ColorMode = 'community' | 'depth';

// Animated background particles
function AnimatedBackground() {
  const particles = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      delay: `${Math.random() * 20}s`,
      duration: `${15 + Math.random() * 10}s`,
      size: 2 + Math.random() * 4,
    }));
  }, []);

  return (
    <div className="animated-bg">
      <div className="grid-overlay" />
      {particles.map((p) => (
        <div
          key={p.id}
          className="particle"
          style={{
            left: p.left,
            top: p.top,
            animationDelay: p.delay,
            animationDuration: p.duration,
            width: p.size,
            height: p.size,
            background: ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981'][p.id % 4],
          }}
        />
      ))}
    </div>
  );
}

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
    <div className="h-screen flex flex-col relative overflow-hidden">
      <AnimatedBackground />
      
      {/* Header */}
      <header className="relative z-20 flex-shrink-0 glass border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              {/* Animated logo */}
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 via-purple-500 to-pink-500 p-[2px]">
                  <div className="w-full h-full bg-slate-900 rounded-[10px] flex items-center justify-center">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </div>
                </div>
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-xl blur opacity-40 -z-10 animate-pulse" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">
                  <span className="gradient-text">Rabbit Hole</span>
                  <span className="text-white/90"> Generator</span>
                </h1>
                <p className="text-sm text-cyan-400/80">Dive deep into Wikipedia connections</p>
              </div>
            </div>
            
            {/* Color mode toggle with animated background */}
            <div className="relative flex items-center gap-1 bg-slate-800/50 rounded-xl p-1.5 border border-white/10">
              <div 
                className={`absolute h-[calc(100%-12px)] bg-gradient-to-r from-cyan-500 to-purple-500 rounded-lg transition-all duration-300 ${
                  colorMode === 'community' ? 'left-1.5 w-[90px]' : 'left-[108px] w-[60px]'
                }`}
              />
              <button
                onClick={() => setColorMode('community')}
                className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  colorMode === 'community' ? 'text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Community
              </button>
              <button
                onClick={() => setColorMode('depth')}
                className={`relative z-10 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  colorMode === 'depth' ? 'text-white' : 'text-slate-400 hover:text-white'
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
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Graph area */}
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-50 backdrop-blur-sm">
              <div className="text-center">
                <div className="loading-spinner mx-auto mb-6" />
                <h3 className="text-2xl font-bold text-white mb-2">Crawling Wikipedia</h3>
                <p className="text-cyan-400 animate-pulse">Discovering connections...</p>
                <div className="mt-6 flex justify-center gap-2">
                  <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center p-8 glass-strong rounded-2xl max-w-md border border-red-500/30">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                  <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-red-400 text-lg font-semibold mb-2">Connection Lost</p>
                <p className="text-slate-400 text-sm mb-6">
                  {String(error).includes('429') 
                    ? 'Wikipedia rate limit reached. Please wait a moment and try again.' 
                    : String(error)}
                </p>
                <button
                  onClick={() => refetch()}
                  className="btn-primary ripple px-6 py-3 text-white font-medium rounded-xl"
                >
                  <span>Try Again</span>
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
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 glass-strong rounded-2xl px-6 py-4 shadow-2xl border border-cyan-500/30">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </div>
                      <span className="text-cyan-400 font-bold">
                        {selectedPath.length - 1} {selectedPath.length === 2 ? 'hop' : 'hops'}
                      </span>
                    </div>
                    <div className="w-px h-8 bg-white/20" />
                    <div className="flex items-center gap-2 max-w-xl overflow-x-auto">
                      {selectedPath.map((nodeId, index) => (
                        <span key={nodeId} className="flex items-center flex-shrink-0">
                          <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                            index === 0 || index === selectedPath.length - 1
                              ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white'
                              : 'bg-slate-700/80 text-slate-300'
                          }`}>
                            {data.nodes.find(n => n.id === nodeId)?.title || nodeId}
                          </span>
                          {index < selectedPath.length - 1 && (
                            <svg className="w-4 h-4 text-cyan-400 mx-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => setSelectedPath(null)}
                      className="ml-2 p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
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
              <div className="text-center max-w-lg">
                {/* Animated icon */}
                <div className="relative mx-auto mb-8 w-32 h-32">
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-3xl blur-xl opacity-30 animate-pulse" />
                  <div className="relative w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl border border-white/10 flex items-center justify-center">
                    <svg className="w-16 h-16 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  </div>
                </div>
                
                <h2 className="text-3xl font-bold mb-4">
                  <span className="gradient-text">Start Your Journey</span>
                </h2>
                <p className="text-slate-400 text-lg mb-8">
                  Enter any Wikipedia article above and watch as connections between topics come alive through interactive visualization
                </p>
                
                {/* Feature highlights */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="glass rounded-xl p-4 card-hover">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-300">Explore Links</p>
                  </div>
                  <div className="glass rounded-xl p-4 card-hover">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-purple-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-300">Find Communities</p>
                  </div>
                  <div className="glass rounded-xl p-4 card-hover">
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-pink-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-300">Shortest Paths</p>
                  </div>
                </div>
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
