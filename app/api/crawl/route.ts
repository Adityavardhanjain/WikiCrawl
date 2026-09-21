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

function sendStreamEvent(controller: ReadableStreamDefaultController, event: string, payload: unknown) {
  try {
    controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    );
    return true;
  } catch {
    return false;
  }
}

function closeStream(controller: ReadableStreamDefaultController): void {
  try {
    controller.close();
  } catch {
    // The client may have disconnected before the crawl completed.
  }
}

export async function POST(request: NextRequest) {
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

    const seedPage = await getPageLinks(seedTitle);
    if (seedPage.missing) {
      const suggestions = await searchWikipedia(seedTitle)
        .then((results) => results.map((result) => result.title))
        .catch(() => []);
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
        let crawlProgress: CrawlProgress = { done: 0, target: 1 };
        const heartbeat = setInterval(() => {
          sendStreamEvent(controller, 'progress', { progress: crawlProgress });
        }, 2000);
        try {
          const { nodes: crawledNodes, edges: crawledEdges, seedId: crawledSeedId, partial, failedTitles } = await crawlWikipedia({
            seedTitle,
            depth: validatedDepth,
            maxNodes: validatedMaxNodes,
            knownIds,
            baseDepth: validatedBaseDepth,
            onProgress: (progress) => {
              crawlProgress = progress;
              sendStreamEvent(controller, 'progress', { progress: crawlProgress });
            },
            onBatch: (nodes, edges) => {
              if (nodes.length > 0) sendStreamEvent(controller, 'nodes', { nodes });
              if (edges.length > 0) sendStreamEvent(controller, 'edges', { edges });
            },
          });

          if (partial) {
            sendStreamEvent(controller, 'warning', { failedTitles });
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
          sendStreamEvent(controller, 'analysis', { metrics: allMetrics, communities });

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

          if (!isExpand && !partial) {
            setCachedResult(cacheKey, seedTitle, validatedDepth, validatedMaxNodes, result);
          }
          sendStreamEvent(controller, 'done', { result });
          clearInterval(heartbeat);
          closeStream(controller);
        } catch (error) {
          clearInterval(heartbeat);
          console.error('Crawl error:', error);
          sendStreamEvent(controller, 'error', {
            error: 'Failed to crawl Wikipedia',
            details: String(error),
          });
          closeStream(controller);
        }
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
    console.error('Crawl request error:', error);
    return NextResponse.json(
      { error: 'Failed to crawl Wikipedia', details: String(error) },
      { status: 500 }
    );
  }
}
