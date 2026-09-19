'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import type { Community, CrawlProgress, CrawlResult, WikiEdge, WikiNode } from '@/types/graph';
import { createCrawlRequest, getCrawlPayload, parseCrawlParams, type CrawlRequest } from '@/lib/crawlRequest';
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

class CrawlNotFoundError extends Error {
  constructor(public readonly title: string, public readonly suggestions: string[]) {
    super('not_found');
  }
}

function validateGraphData(data: Partial<CrawlResult> | null | undefined): string[] {
  if (!data) {
    return ['No graph data is available.'];
  }

  const issues: string[] = [];
  if (!Array.isArray(data.nodes)) {
    issues.push('Node list is missing.');
    return issues;
  }

  if (!Array.isArray(data.edges)) {
    issues.push('Edge list is missing.');
  }

  if (data.nodes.length === 0) {
    issues.push('Graph is empty.');
  }

  const nodeIds = data.nodes.map((node) => node?.id);
  const duplicateNodeIds = new Set(nodeIds.filter((id, index) => id && nodeIds.indexOf(id) !== index));
  if (duplicateNodeIds.size > 0) {
    issues.push('Graph contains duplicate node IDs.');
  }

  const validNodeIds = new Set(nodeIds);
  for (const edge of data.edges ?? []) {
    if (!validNodeIds.has(edge.source) || !validNodeIds.has(edge.target)) {
      issues.push(`Edge references missing nodes: ${edge.source} -> ${edge.target}`);
    }
  }

  for (const node of data.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id.trim()) {
      issues.push('A node has an invalid id.');
      continue;
    }

    if (!Number.isFinite(node.depth)) {
      issues.push(`Node ${node.id} has an invalid depth.`);
    }

    if (!Number.isFinite(node.pagerank)) {
      issues.push(`Node ${node.id} has an invalid PageRank.`);
    }

    if (!Number.isFinite(node.betweenness)) {
      issues.push(`Node ${node.id} has an invalid betweenness value.`);
    }

    if (data.positions?.[node.id] && (!Number.isFinite(data.positions[node.id].x) || !Number.isFinite(data.positions[node.id].y))) {
      issues.push(`Node ${node.id} has invalid saved coordinates.`);
    }
  }

  const invalidPositions = Object.entries(data.positions ?? {}).filter(([, pos]) => (
    !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)
  ));

  if (invalidPositions.length > 0) {
    issues.push('One or more saved node positions are invalid.');
  }

  return issues;
}

async function readCrawlResponse(
  response: Response,
  onProgress?: (progress: CrawlProgress) => void,
  handlers?: {
    onNodes?: (nodes: WikiNode[]) => void;
    onEdges?: (edges: WikiEdge[]) => void;
    onAnalysis?: (nodes: WikiNode[], communities: Community[]) => void;
    onExtracts?: (extracts: { nodeId: string; extract: string | null }[]) => void;
  }
): Promise<CrawlResult> {
  if (!response.ok) {
    const errorData = await response.json();
    if (response.status === 404 && errorData.error === 'not_found') {
      throw new CrawlNotFoundError(errorData.title, errorData.suggestions ?? []);
    }
    throw new Error(errorData.error || 'Failed to crawl');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    onProgress?.({ done: 1, target: 1 });
    return response.json() as Promise<CrawlResult>;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: CrawlResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const eventLine = chunk.split('\n').find((line) => line.startsWith('event:'));
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;

      const payload = JSON.parse(dataLine.slice(5).trim());
      const event = eventLine?.slice(6).trim();
      if (payload?.progress && onProgress) {
        onProgress(payload.progress as CrawlProgress);
      }
      if (event === 'nodes') handlers?.onNodes?.(payload.nodes ?? []);
      if (event === 'edges') handlers?.onEdges?.(payload.edges ?? []);
      if (event === 'analysis') handlers?.onAnalysis?.(payload.nodes ?? [], payload.communities ?? []);
      if (event === 'extracts') handlers?.onExtracts?.(payload.extracts ?? []);
      if (payload?.result) {
        finalResult = payload.result as CrawlResult;
        if (event === 'done') onProgress?.({ done: 1, target: 1 });
      }
      if (payload?.error) throw new Error(payload.error);
    }
  }

  if (!finalResult) throw new Error('Crawl stream ended without a final result');
  return finalResult;
}

// Animated background particles
function AnimatedBackground() {
  return (
    <div className="animated-bg">
      <div className="grid-overlay" />
    </div>
  );
}

export default function Home() {
  const queryClient = useQueryClient();
  
  // State
  const [depth, setDepth] = useState(3);
  const [maxNodes, setMaxNodes] = useState(500);
  const [submittedRequest, setSubmittedRequest] = useState<CrawlRequest | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('community');
  const [selectedNode, setSelectedNode] = useState<WikiNode | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [liveData, setLiveData] = useState<CrawlResult | null>(null);
  const previousDataRef = useRef<CrawlResult | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<{ title: string; suggestions: string[] } | null>(null);
  const [explorationHistory, setExplorationHistory] = useState<Array<{ id: string; title: string }>>([]);
  const liveUpdateRef = useRef<((current: CrawlResult) => CrawlResult) | null>(null);
  const liveUpdateFrameRef = useRef<number | null>(null);
  const submittedRequestRef = useRef<CrawlRequest | null>(null);
  const requestNonceRef = useRef(0);

  const mergeLiveData = useCallback((request: CrawlRequest, update: (current: CrawlResult) => CrawlResult) => {
    const pendingUpdate = liveUpdateRef.current;
    liveUpdateRef.current = pendingUpdate
      ? (current) => update(pendingUpdate(current))
      : update;

    if (liveUpdateFrameRef.current !== null) return;

    liveUpdateFrameRef.current = window.requestAnimationFrame(() => {
      const pendingUpdate = liveUpdateRef.current;
      liveUpdateRef.current = null;
      liveUpdateFrameRef.current = null;
      if (!pendingUpdate || submittedRequestRef.current?.nonce !== request.nonce) return;

      setLiveData((current) => pendingUpdate(current ?? {
        id: 'streaming',
        seedId: request.seed,
        nodes: [],
        edges: [],
        communities: [],
        crawledAt: new Date().toISOString(),
        positions: {},
      }));
    });
  }, []);

  useEffect(() => () => {
    if (liveUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(liveUpdateFrameRef.current);
    }
  }, []);

  const updateLoadingProgress = useCallback((progress: CrawlProgress) => {
    const safeTarget = Math.max(progress.target, 1);
    const ratio = Math.min(1, Math.max(0, progress.done / safeTarget));
    setLoadingProgress((current) => Math.max(current, ratio));
  }, []);

  // Query for crawl data
  const { data, isLoading, error, refetch } = useQuery<CrawlResult>({
    queryKey: submittedRequest
      ? ['crawl', submittedRequest.seed, submittedRequest.depth, submittedRequest.maxNodes, submittedRequest.nonce]
      : ['crawl', 'idle'],
    queryFn: async () => {
      if (!submittedRequest) throw new Error('No crawl request submitted');
      const request = submittedRequest;
      try {
        const response = await fetch('/api/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getCrawlPayload(request)),
        });
        const result = await readCrawlResponse(response, updateLoadingProgress, {
          onNodes: (nodes) => mergeLiveData(request, (current) => ({
            ...current,
            nodes: Array.from(new Map([...current.nodes, ...nodes].filter((node) => node?.id).map((node) => [node.id, node])).values()),
          })),
          onEdges: (edges) => mergeLiveData(request, (current) => ({
            ...current,
            edges: Array.from(new Map([...current.edges, ...edges].filter((edge) => edge?.source && edge?.target).map((edge) => [`${edge.source}|${edge.target}`, edge])).values()),
          })),
          onAnalysis: (nodes, communities) => mergeLiveData(request, (current) => ({
            ...current,
            nodes: Array.from(new Map([...current.nodes, ...nodes].filter((node) => node?.id).map((node) => [node.id, node])).values()),
            communities,
          })),
          onExtracts: (extracts) => mergeLiveData(request, (current) => ({
            ...current,
            nodes: current.nodes.map((node) => {
              const extract = extracts.find((item) => item.nodeId === node.id)?.extract;
              return extract ? { ...node, extract } : node;
            }),
          })),
        });
        const issues = validateGraphData(result);
        if (issues.length > 0) throw new Error(issues[0]);
        if (submittedRequestRef.current?.nonce === request.nonce) {
          setLiveData(null);
        }
        return result;
      } catch (error) {
        if (error instanceof CrawlNotFoundError) {
          setNotFound({ title: error.title, suggestions: error.suggestions });
          setGraphError(null);
          throw error;
        }
        const message = error instanceof Error ? error.message : 'Unable to explore this topic right now.';
        setGraphError(message);
        throw error;
      }
    },
    enabled: submittedRequest !== null,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  const displayData = data ?? liveData ?? previousDataRef.current;

  useEffect(() => {
    if (!displayData) return;

    const stillExists = displayData.nodes.some((node) => node.id === selectedNode?.id);
    if (selectedNode && !stillExists) {
      setSelectedNode(null);
    }
  }, [displayData, selectedNode]);

  useEffect(() => {
    if (!selectedNode || !selectedNode.title) return;

    setExplorationHistory((current) => {
      const next = [...current];
      const existingIndex = next.findIndex((item) => item.id === selectedNode.id);
      if (existingIndex >= 0) {
        next.splice(existingIndex, 1);
      }
      next.push({ id: selectedNode.id, title: selectedNode.title });
      return next.slice(-6);
    });
  }, [selectedNode]);

  useEffect(() => {
    if (!isLoading) {
      const timeout = window.setTimeout(() => setLoadingProgress(0), 300);
      return () => window.clearTimeout(timeout);
    }

    if (loadingProgress === 0) {
      setLoadingProgress(5);
    }
  }, [isLoading, loadingProgress]);

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
          baseGraph: displayData ?? undefined,
        }),
      });
      
      const result = await readCrawlResponse(response);
      const issues = validateGraphData(result);
      if (issues.length > 0) throw new Error(issues[0]);
      return result;
    },
    onSuccess: (newData) => {
      if (displayData) {
        if (submittedRequest) {
          queryClient.setQueryData(
            ['crawl', submittedRequest.seed, submittedRequest.depth, submittedRequest.maxNodes, submittedRequest.nonce],
            newData,
          );
        }
      }
    },
    onError: (error) => {
      setGraphError(error instanceof Error ? error.message : 'Could not explore this page.');
    },
  });

  // Handle search
  const handleSearch = useCallback((title: string) => {
    previousDataRef.current = data ?? liveData;
    const request = createCrawlRequest(title, depth, maxNodes, ++requestNonceRef.current);
    const url = new URL(window.location.href);
    url.searchParams.set('seed', title);
    url.searchParams.set('depth', request.depth.toString());
    url.searchParams.set('nodes', request.maxNodes.toString());
    window.history.replaceState({}, '', url.toString());
    submittedRequestRef.current = request;
    setSubmittedRequest(request);
    liveUpdateRef.current = null;
    if (liveUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(liveUpdateFrameRef.current);
      liveUpdateFrameRef.current = null;
    }
    setLiveData(null);
    setLoadingProgress(0);
    setGraphError(null);
    setNotFound(null);
    setSelectedNode(null);
    setFocusedNode(null);
    setExplorationHistory([]);
  }, [data, depth, liveData, maxNodes]);

  // Handle node click
  const handleNodeClick = useCallback((node: WikiNode) => {
    setSelectedNode(node);
    setFocusedNode(node.id);
    setGraphError(null);
  }, []);

  // Handle node selection from sidebar
  const handleNodeSelect = useCallback((nodeId: string) => {
    setFocusedNode(nodeId);
    const node = displayData?.nodes.find(n => n.id === nodeId);
    if (node) {
      setSelectedNode(node);
    }
  }, [displayData]);

  // Handle community selection
  const handleCommunitySelect = useCallback((communityId: number) => {
    if (!displayData) return;
    const firstNode = displayData.nodes.find(n => n.communityId === communityId);
    if (firstNode) {
      setFocusedNode(firstNode.id);
    }
  }, [displayData]);

  // Handle expand from node
  const handleExpand = useCallback((nodeId: string) => {
    setGraphError(null);
    expandMutation.mutate(nodeId);
  }, [expandMutation]);

  // Load from URL params
  useEffect(() => {
    const { seed, depth: urlDepth, maxNodes: urlMaxNodes } = parseCrawlParams(window.location.search);
    setDepth(urlDepth);
    setMaxNodes(urlMaxNodes);

    if (seed) {
      const request = createCrawlRequest(seed, urlDepth, urlMaxNodes, ++requestNonceRef.current);
      submittedRequestRef.current = request;
      setSubmittedRequest(request);
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    const issues = validateGraphData(data);
    if (issues.length > 0) {
      setGraphError(issues[0]);
      setSelectedNode(null);
      setFocusedNode(null);
    }
  }, [data]);

  return (
    <div className="app-shell h-screen flex flex-col relative overflow-hidden">
      <AnimatedBackground />
      
      {/* Header */}
      <header className="app-header relative z-20 flex-shrink-0 glass border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          {isLoading && !displayData && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
                <span>Crawling Wikipedia</span>
                <span>{Math.round(loadingProgress * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 transition-all duration-500 ease-out"
                  style={{ width: `${loadingProgress * 100}%` }}
                />
              </div>
            </div>
          )}
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
                  <span className="gradient-text">WikiCrawl</span>
                  <span className="text-white/90"> / field notes</span>
                </h1>
                <p className="text-sm text-cyan-400/80">A visual index of unexpected connections</p>
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
          {isLoading && !displayData && (
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

          {isLoading && displayData && (
            <div className="absolute inset-x-4 top-4 z-30 flex justify-center">
              <div className="flex items-center gap-3 rounded-full border border-cyan-500/30 bg-slate-950/80 px-4 py-2 text-xs text-cyan-200 shadow-lg backdrop-blur-md">
                <span>Exploring a new neighborhood...</span>
                <span className="w-24 text-right tabular-nums transition-opacity duration-300">{Math.round(loadingProgress * 100)}%</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-700/80">
                  <span
                    className="block h-full rounded-full bg-cyan-400 transition-[width] duration-300 ease-out"
                    style={{ width: `${loadingProgress * 100}%` }}
                  />
                </span>
              </div>
            </div>
          )}

          {notFound && (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="glass-strong max-w-lg rounded-2xl border border-cyan-500/30 p-8 text-center">
                <p className="mb-2 text-lg font-semibold text-cyan-300">No Wikipedia article named &quot;{notFound.title}&quot;</p>
                <p className="mb-5 text-sm text-slate-400">Try one of these related articles:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {notFound.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSearch(suggestion)}
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-200 transition hover:bg-cyan-400/20 hover:text-white"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && !notFound && !displayData && (
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

          {displayData && (
            <>
              {explorationHistory.length > 0 && (
                <div className="absolute left-1/2 top-4 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-300 backdrop-blur-md">
                  {explorationHistory.map((step, index) => (
                    <div key={step.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const node = displayData.nodes.find((candidate) => candidate.id === step.id);
                          if (node) {
                            setSelectedNode(node);
                            setFocusedNode(node.id);
                          }
                        }}
                        className="rounded-full bg-white/5 px-2.5 py-1.5 text-slate-200 transition hover:bg-white/10 hover:text-white"
                      >
                        {step.title}
                      </button>
                      {index < explorationHistory.length - 1 && (
                        <span className="text-slate-500">→</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <GraphCanvas
                data={displayData}
                colorMode={colorMode}
                onNodeClick={handleNodeClick}
                focusedNode={focusedNode}
              />
              
              <NodeDetailPanel
                node={selectedNode}
                data={displayData}
                onClose={() => {
                  setSelectedNode(null);
                  setFocusedNode(null);
                }}
                onExpand={handleExpand}
                isExpanding={expandMutation.isPending}
              />

            </>
          )}

          {graphError && displayData && (
            <div className="absolute inset-x-0 bottom-6 z-30 flex justify-center px-4">
              <div className="flex max-w-lg items-center gap-4 rounded-2xl border border-amber-500/30 bg-slate-950/85 px-4 py-3 text-sm text-amber-200 shadow-xl backdrop-blur-md">
                <span>{graphError}</span>
                <button type="button" onClick={() => refetch()} className="shrink-0 text-xs font-semibold uppercase tracking-wide text-cyan-300 hover:text-white">
                  Retry
                </button>
              </div>
            </div>
          )}

          {!displayData && !isLoading && !error && !notFound && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="atlas-empty-state text-center max-w-xl">
                {/* Animated icon */}
                <div className="relative mx-auto mb-7 w-24 h-24">
                  <div className="relative w-full h-full bg-slate-900/70 rounded-full border border-cyan-400/30 flex items-center justify-center">
                    <svg className="w-16 h-16 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  </div>
                </div>
                
                <h2 className="text-3xl font-semibold mb-3">
                  <span className="gradient-text">Start Your Journey</span>
                </h2>
                <p className="text-slate-400 text-base mb-7">
                  Enter any Wikipedia article above and watch as connections between topics come alive through interactive visualization
                </p>
                
                {/* Feature highlights */}
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-3">
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                      </svg>
                    </div>
                    <p>Explore Links</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p>Find Communities</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <div className="w-6 h-6 rounded-full bg-pink-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </div>
                    <p>Shortest Paths</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        {displayData && <Sidebar data={displayData} onNodeSelect={handleNodeSelect} onCommunitySelect={handleCommunitySelect} focusedNode={focusedNode} />}
      </div>
    </div>
  );
}
