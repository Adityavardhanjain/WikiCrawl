import { NextRequest, NextResponse } from 'next/server';
import { crawlWikipedia, buildGraph } from '@/lib/crawler';
import { analyzeGraph } from '@/lib/graphAnalysis';
import { getCachedResult, setCachedResult, generateCacheKey } from '@/lib/db';
import { getPageExtract } from '@/lib/wikipedia';
import { nanoid } from 'nanoid';
import type { CrawlResult, CrawlRequest } from '@/types/graph';

const encoder = new TextEncoder();

function sendStreamEvent(controller: ReadableStreamDefaultController, event: string, payload: unknown) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CrawlRequest;
    const { seedTitle, depth, maxNodes, baseGraph } = body;

    if (!seedTitle || typeof seedTitle !== 'string') {
      return NextResponse.json(
        { error: 'seedTitle is required' },
        { status: 400 }
      );
    }

    const validatedDepth = Math.min(Math.max(depth || 1, 1), 3);
    const validatedMaxNodes = Math.min(Math.max(maxNodes || 100, 50), 500);

    const cacheKey = generateCacheKey(seedTitle, validatedDepth, validatedMaxNodes);
    const cachedResult = baseGraph ? null : getCachedResult(cacheKey);

    if (cachedResult) {
      return NextResponse.json(cachedResult);
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const crawlProgress = { visited: 0, total: 1 };
          const { nodes: crawledNodes, edges: crawledEdges, seedId: crawledSeedId } = await crawlWikipedia({
            seedTitle,
            depth: validatedDepth,
            maxNodes: validatedMaxNodes,
            onProgress: (visited, total) => {
              crawlProgress.visited = visited;
              crawlProgress.total = Math.max(total, 1);
              sendStreamEvent(controller, 'progress', { progress: crawlProgress });
            },
            onBatch: (nodes, edges) => {
              if (nodes.length > 0) sendStreamEvent(controller, 'nodes', { nodes });
              if (edges.length > 0) sendStreamEvent(controller, 'edges', { edges });
            },
          });

          const nodeMap = new Map<string, CrawlResult['nodes'][number]>();
          for (const node of baseGraph?.nodes ?? []) {
            nodeMap.set(node.id, node);
          }
          for (const node of crawledNodes) {
            if (!nodeMap.has(node.id)) {
              nodeMap.set(node.id, node);
            }
          }

          const edgeKeys = new Set<string>();
          const edges = [...(baseGraph?.edges ?? []), ...crawledEdges].filter((edge) => {
            const key = `${edge.source}|${edge.target}`;
            if (edgeKeys.has(key)) return false;
            edgeKeys.add(key);
            return true;
          });
          const nodes = Array.from(nodeMap.values());
          const graph = buildGraph(nodes, edges);

          for (const [nodeId, position] of Object.entries(baseGraph?.positions ?? {})) {
            if (graph.hasNode(nodeId)) {
              graph.setNodeAttribute(nodeId, 'x', position.x);
              graph.setNodeAttribute(nodeId, 'y', position.y);
            }
          }

          const seedId = baseGraph?.seedId ?? crawledSeedId;
          const { nodes: analyzedNodes, communities } = analyzeGraph(graph, seedId);

          sendStreamEvent(controller, 'analysis', {
            nodes: analyzedNodes,
            communities,
          });

          const topNodes = analyzedNodes
            .sort((a, b) => b.pagerank - a.pagerank)
            .slice(0, 20);

          const extracts = await Promise.all(
            topNodes.map(async (node) => {
              try {
                const extract = await getPageExtract(node.title);
                return { nodeId: node.id, extract: extract ? extract.slice(0, 300) : null };
              } catch {
                return { nodeId: node.id, extract: null };
              }
            })
          );

          for (const { nodeId, extract } of extracts) {
            const node = analyzedNodes.find((candidate) => candidate.id === nodeId);
            if (node && extract) {
              node.extract = extract;
            }
          }

          sendStreamEvent(controller, 'extracts', { extracts });

          const positions = baseGraph?.positions ?? {};

          const result: CrawlResult = {
            id: nanoid(),
            seedId,
            nodes: analyzedNodes,
            edges,
            communities,
            crawledAt: new Date().toISOString(),
            positions,
            progress: { visited: crawlProgress.visited, total: Math.max(crawlProgress.total, 1) },
          };

          if (!baseGraph) {
            setCachedResult(cacheKey, seedTitle, validatedDepth, validatedMaxNodes, result);
          }
          sendStreamEvent(controller, 'done', { result });
          controller.close();
        } catch (error) {
          console.error('Crawl error:', error);
          sendStreamEvent(controller, 'error', {
            error: 'Failed to crawl Wikipedia',
            details: String(error),
          });
          controller.close();
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
