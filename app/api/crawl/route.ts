import { NextRequest, NextResponse } from 'next/server';
import { crawlWikipedia, buildGraph } from '@/lib/crawler';
import { analyzeGraph } from '@/lib/graphAnalysis';
import { computeLayout, normalizeLayout } from '@/lib/layout';
import { getCachedResult, setCachedResult, generateCacheKey } from '@/lib/db';
import { getPageExtract } from '@/lib/wikipedia';
import { nanoid } from 'nanoid';
import type { CrawlResult, CrawlRequest } from '@/types/graph';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CrawlRequest;
    const { seedTitle, depth, maxNodes } = body;

    if (!seedTitle || typeof seedTitle !== 'string') {
      return NextResponse.json(
        { error: 'seedTitle is required' },
        { status: 400 }
      );
    }

    const validatedDepth = Math.min(Math.max(depth || 1, 1), 3);
    const validatedMaxNodes = Math.min(Math.max(maxNodes || 100, 50), 500);

    // Check cache first
    const cacheKey = generateCacheKey(seedTitle, validatedDepth, validatedMaxNodes);
    const cachedResult = getCachedResult(cacheKey);
    
    if (cachedResult) {
      return NextResponse.json(cachedResult);
    }

    // Perform crawl
    const { nodes, edges, seedId } = await crawlWikipedia({
      seedTitle,
      depth: validatedDepth,
      maxNodes: validatedMaxNodes,
    });

    // Build graph
    const graph = buildGraph(nodes, edges);

    // Analyze graph
    const { nodes: analyzedNodes, communities } = analyzeGraph(graph, seedId);

    // Get page extracts for top nodes (to reduce API calls)
    const topNodes = analyzedNodes
      .sort((a, b) => b.pagerank - a.pagerank)
      .slice(0, 20);
    
    for (const node of topNodes) {
      try {
        const extract = await getPageExtract(node.title);
        if (extract) {
          node.extract = extract.slice(0, 300); // Limit extract length
        }
      } catch (e) {
        // Ignore extract errors
      }
    }

    // Compute layout
    const layout = computeLayout(graph, { iterations: 100 });
    const positions = normalizeLayout(layout, 1000, 800, 50);

    // Create result
    const result: CrawlResult = {
      id: nanoid(),
      seedId,
      nodes: analyzedNodes,
      edges,
      communities,
      crawledAt: new Date().toISOString(),
      positions,
    };

    // Cache result
    setCachedResult(cacheKey, seedTitle, validatedDepth, validatedMaxNodes, result);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Crawl error:', error);
    return NextResponse.json(
      { error: 'Failed to crawl Wikipedia', details: String(error) },
      { status: 500 }
    );
  }
}
