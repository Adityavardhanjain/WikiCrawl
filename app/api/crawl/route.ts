import { NextRequest, NextResponse } from 'next/server';
import { crawlWikipedia, buildGraph, sanitizeGraphData } from '@/lib/crawler';
import { analyzeGraph } from '@/lib/graphAnalysis';
import { getCachedResult, setCachedResult, generateCacheKey } from '@/lib/db';
import { getPageLinks, searchWikipedia } from '@/lib/wikipedia';
import { nanoid } from 'nanoid';
import type { CrawlProgress, CrawlResult, CrawlRequest, WikiNode, WikiEdge } from '@/types/graph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Assumes a Vercel plan that permits 60 seconds for this Node.js function.
export const maxDuration = 60;

const encoder = new TextEncoder();

export function safeSend(controller: ReadableStreamDefaultController, event: string, payload: unknown): boolean {
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
    return true;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

export function safeClose(controller: ReadableStreamDefaultController): boolean {
  try {
    controller.close();
    return true;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const crawlAbortController = new AbortController();
  let aborted = request.signal.aborted;
  const handleAbort = () => {
    aborted = true;
    crawlAbortController.abort();
  };
  request.signal.addEventListener('abort', handleAbort, { once: true });
  try {
    const body = (await request.json()) as CrawlRequest;
    const { seedTitle, depth, maxNodes, knownNodeIds, knownEdgeIndexPairs, baseDepth } = body;

    if (!seedTitle || typeof seedTitle !== 'string') {
      return NextResponse.json(
        { error: 'seedTitle is required' },
        { status: 400 }
      );
    }

    const isExpand = Array.isArray(knownNodeIds);
    const knownIds = knownNodeIds ?? [];
    const validatedBaseDepth = Math.min(Math.max(Math.trunc(baseDepth || 0), 0), 3);

    const validatedDepth = Math.min(Math.max(depth || 2, 1), 3);
    const validatedMaxNodes = Math.min(Math.max(maxNodes || 150, 50), 500);

    const seedPage = await getPageLinks(seedTitle, undefined, crawlAbortController.signal);
    if (seedPage.missing) {
      const suggestions = await searchWikipedia(seedTitle, crawlAbortController.signal)
        .then((results) => results.map((result) => result.title))
        .catch((error) => {
          if (error instanceof Error && error.name === 'AbortError') throw error;
          return [];
        });
      return NextResponse.json(
        { error: 'not_found', title: seedTitle, suggestions },
        { status: 404 },
      );
    }

    const cacheKey = generateCacheKey(seedTitle, validatedDepth, validatedMaxNodes);
    const cachedResult = isExpand ? null : getCachedResult(cacheKey);

    if (cachedResult) {
      return NextResponse.json(cachedResult);
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let crawlProgress: CrawlProgress = { done: 0, target: 1 };
          const { nodes: crawledNodes, edges: crawledEdges, seedId: crawledSeedId, partial, failedTitles } = await crawlWikipedia({
            seedTitle,
            depth: validatedDepth,
            maxNodes: validatedMaxNodes,
            knownIds,
            baseDepth: validatedBaseDepth,
            signal: crawlAbortController.signal,
            onProgress: (progress) => {
              crawlProgress = progress;
              if (!safeSend(controller, 'progress', { progress: crawlProgress })) {
                aborted = true;
                crawlAbortController.abort();
              }
            },
            onBatch: (nodes, edges) => {
              if (nodes.length > 0 && !safeSend(controller, 'nodes', { nodes })) {
                aborted = true;
                crawlAbortController.abort();
              }
              if (edges.length > 0 && !safeSend(controller, 'edges', { edges })) {
                aborted = true;
                crawlAbortController.abort();
              }
            },
          });

          if (aborted || request.signal.aborted) {
            safeClose(controller);
            return;
          }

          if (partial) {
            if (!safeSend(controller, 'warning', { failedTitles })) aborted = true;
          }
          if (aborted || request.signal.aborted) {
            safeClose(controller);
            return;
          }

          const { nodes: deltaNodes, edges: deltaEdges } = sanitizeGraphData(crawledNodes, crawledEdges);
          const deltaNodeIds = new Set(deltaNodes.map((node) => node.id));

          // Reconstruct the caller's known edges (decoded from index pairs) so pagerank/betweenness/
          // communities are computed for the whole merged graph, without the client resending it.
          const knownEdges: WikiEdge[] = isExpand
            ? (knownEdgeIndexPairs ?? [])
                .filter(([sourceIndex, targetIndex]) => knownIds[sourceIndex] !== undefined && knownIds[targetIndex] !== undefined)
                .map(([sourceIndex, targetIndex]) => ({ source: knownIds[sourceIndex], target: knownIds[targetIndex] }))
            : [];

          const analysisNodeSource: WikiNode[] = isExpand
            ? [
                ...knownIds.map((id): WikiNode => ({
                  id, title: id, url: '', depth: 0,
                  inDegree: 0, outDegree: 0, pagerank: 0, betweenness: 0, communityId: 0,
                })),
                ...deltaNodes,
              ]
            : deltaNodes;
          const analysisEdgeSource = isExpand ? [...knownEdges, ...deltaEdges] : deltaEdges;

          const { nodes: validAnalysisNodes, edges: validAnalysisEdges } = sanitizeGraphData(analysisNodeSource, analysisEdgeSource);
          const graph = buildGraph(validAnalysisNodes, validAnalysisEdges);

          const seedId = crawledSeedId;
          const { nodes: analyzedNodes, communities } = analyzeGraph(graph, seedId);

          const allMetrics = Object.fromEntries(analyzedNodes.map((node) => [node.id, {
            pagerank: node.pagerank,
            betweenness: node.betweenness,
            communityId: node.communityId,
            inDegree: node.inDegree,
            outDegree: node.outDegree,
          }]));
          if (!safeSend(controller, 'analysis', { metrics: allMetrics, communities })) aborted = true;
          if (aborted || request.signal.aborted) {
            safeClose(controller);
            return;
          }

          // Expand responses are deltas: only new nodes/edges, plus updated metrics for known nodes.
          const resultNodes = isExpand ? analyzedNodes.filter((node) => deltaNodeIds.has(node.id)) : analyzedNodes;
          const resultEdges = isExpand ? deltaEdges : validAnalysisEdges;
          const resultMetrics = isExpand
            ? Object.fromEntries(Object.entries(allMetrics).filter(([id]) => !deltaNodeIds.has(id)))
            : undefined;

          const result: CrawlResult = {
            id: nanoid(),
            seedId,
            nodes: resultNodes,
            edges: resultEdges,
            communities,
            crawledAt: new Date().toISOString(),
            positions: {},
            progress: { done: 1, target: 1 },
            partial,
            failedTitles,
            metrics: resultMetrics,
          };

          if (!aborted && !request.signal.aborted && !isExpand && !partial) {
            setCachedResult(cacheKey, seedTitle, validatedDepth, validatedMaxNodes, result);
          }
          if (!aborted) safeSend(controller, 'done', { result });
          safeClose(controller);
        } catch (error) {
          if (aborted || request.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
            safeClose(controller);
            return;
          }
          console.error('Crawl error:', error);
          safeSend(controller, 'error', {
            error: 'Failed to crawl Wikipedia',
            details: String(error),
          });
          safeClose(controller);
        }
      },
      cancel() {
        aborted = true;
        request.signal.removeEventListener('abort', handleAbort);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    request.signal.removeEventListener('abort', handleAbort);
    if (aborted || request.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return new Response(null, { status: 499 });
    }
    console.error('Crawl request error:', error);
    return NextResponse.json(
      { error: 'Failed to crawl Wikipedia', details: String(error) },
      { status: 500 }
    );
  }
}
