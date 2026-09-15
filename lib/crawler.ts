import Graph from 'graphology';
import { getPageLinksBatch, titleToUrl } from './wikipedia';
import type { WikiNode, WikiEdge } from '@/types/graph';

const WIKIPEDIA_BATCH_SIZE = 8;
const MAX_EDGES_PER_NODE = 50;
const MAX_REQUEST_BUDGET = 500;

interface CrawlProgress {
  nodes: WikiNode[];
  nodeIds: Set<string>;
  edges: WikiEdge[];
  edgeKeys: Set<string>;
  visited: Set<string>;
  queue: { title: string; depth: number }[];
  resolvedTitles: Map<string, string>;
}

export function getCrawlRequestBudget(maxNodes: number, depth: number): number {
  const requestedDepthFactor = Math.min(Math.max(depth, 1), 3);
  const rawBudget = Math.max(maxNodes * 8, 200) * requestedDepthFactor;
  return Math.min(Math.max(rawBudget, 200), MAX_REQUEST_BUDGET);
}

export function shouldQueuePage(
  title: string,
  visited: Set<string>,
  queued: Set<string> = new Set()
): boolean {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;
  if (visited.has(normalized) || queued.has(normalized)) return false;
  return true;
}

function normalizeTitle(title: string): string {
  return title.replace(/_/g, ' ').trim();
}

function getCanonicalTitle(title: string, resolvedTitles: Map<string, string>): string {
  const normalized = normalizeTitle(title);
  // Check if we have a resolved title
  const resolved = resolvedTitles.get(normalized);
  return resolved || normalized;
}

export interface CrawlOptions {
  seedTitle: string;
  depth: number;
  maxNodes: number;
  onProgress?: (visited: number, total: number) => void;
  onBatch?: (nodes: WikiNode[], edges: WikiEdge[]) => void;
}

export async function crawlWikipedia(options: CrawlOptions): Promise<{
  nodes: WikiNode[];
  edges: WikiEdge[];
  seedId: string;
}> {
  const { seedTitle, depth, maxNodes, onProgress, onBatch } = options;
  const requestBudget = getCrawlRequestBudget(maxNodes, depth);
  const pageLinkLimit = Math.min(300, Math.max(120, maxNodes));

  const progress: CrawlProgress = {
    nodes: [],
    nodeIds: new Set(),
    edges: [],
    edgeKeys: new Set<string>(),
    visited: new Set(),
    queue: [],
    resolvedTitles: new Map(),
  };

  const queuedTitles = new Set<string>();

  // Start with the seed page
  const seedNormalized = normalizeTitle(seedTitle);
  progress.queue.push({ title: seedNormalized, depth: 0 });
  queuedTitles.add(seedNormalized);

  let visited = 0;
  let requestsUsed = 0;

  while (progress.queue.length > 0 && progress.nodes.length < maxNodes && requestsUsed < requestBudget) {
    const batchSize = Math.min(WIKIPEDIA_BATCH_SIZE, progress.queue.length, requestBudget - requestsUsed);
    const batch = progress.queue.splice(0, batchSize);
    if (batch.length === 0) break;

    const batchTitles = batch.map(({ title }) => title);
    const batchNodeIds = new Set(progress.nodes.map((node) => node.id));
    const batchEdgeKeys = new Set(progress.edges.map((edge) => `${edge.source}|${edge.target}`));
    let batchResponse;
    try {
      batchResponse = await getPageLinksBatch(batchTitles);
      requestsUsed += 1;
    } catch {
      continue;
    }
    const batchResults = batch.map(({ title, depth: currentDepth }) => {
      const canonicalTitle = getCanonicalTitle(title, progress.resolvedTitles);
      const result = batchResponse.pages.find((page) => page.title === title);
      if (progress.visited.has(canonicalTitle) || !result) {
        return null;
      }

      return { title, currentDepth, result, canonicalTitle };
    });

    const collectedLinks = new Map<string, number>();

    for (const item of batchResults) {
      if (!item) continue;

      const { title, currentDepth, result, canonicalTitle } = item;
      if (progress.visited.has(canonicalTitle)) {
        continue;
      }

      progress.visited.add(canonicalTitle);
      visited++;

      if (onProgress) {
        onProgress(visited, Math.max(progress.nodes.length, 1));
      }

      if (result.resolvedTitle !== normalizeTitle(title)) {
        progress.resolvedTitles.set(normalizeTitle(title), result.resolvedTitle);
      }

      const links = result.links.slice(0, Math.min(pageLinkLimit, result.links.length));
      collectedLinks.set(title, links.length);
      const nodeId = getCanonicalTitle(title, progress.resolvedTitles);

      if (!progress.nodeIds.has(nodeId)) {
        progress.nodes.push({
          id: nodeId,
          title: nodeId,
          url: titleToUrl(nodeId),
          extract: '',
          depth: currentDepth,
          inDegree: 0,
          outDegree: links.length,
          pagerank: 0,
          betweenness: 0,
          communityId: 0,
        });
        progress.nodeIds.add(nodeId);
      }

      if (currentDepth < depth) {
          for (let linkIndex = 0; linkIndex < links.length; linkIndex++) {
            const link = links[linkIndex];
          const normalizedLink = normalizeTitle(link);
          const canonicalLink = getCanonicalTitle(normalizedLink, progress.resolvedTitles);

            if (linkIndex < MAX_EDGES_PER_NODE) {
              const edgeKey = `${nodeId}|${canonicalLink}`;
              if (!progress.edgeKeys.has(edgeKey)) {
                progress.edgeKeys.add(edgeKey);
                progress.edges.push({
                  source: nodeId,
                  target: canonicalLink,
                });
              }
          }

          if (
            !progress.visited.has(canonicalLink) &&
            progress.nodes.length < maxNodes &&
            shouldQueuePage(normalizedLink, progress.visited, queuedTitles)
          ) {
            progress.queue.push({ title: normalizedLink, depth: currentDepth + 1 });
            queuedTitles.add(normalizedLink);
          }
        }
      }

    }

    onBatch?.(
      progress.nodes.filter((node) => !batchNodeIds.has(node.id)),
      progress.edges.filter((edge) => !batchEdgeKeys.has(`${edge.source}|${edge.target}`)),
    );
    for (const edge of progress.edges) {
      batchEdgeKeys.add(`${edge.source}|${edge.target}`);
    }

    let continueToken = batchResponse.continueToken;
    while (
      continueToken &&
      progress.nodes.length < maxNodes &&
      requestsUsed < requestBudget &&
      batchResults.some((item) => item !== null && item.currentDepth < depth) &&
      Array.from(collectedLinks.values()).some((count) => count < pageLinkLimit)
    ) {
      let paginatedResponse;
      try {
        paginatedResponse = await getPageLinksBatch(batchTitles, continueToken);
        requestsUsed += 1;
      } catch {
        break;
      }

      for (const paginatedResult of paginatedResponse.pages) {
        const currentCount = collectedLinks.get(paginatedResult.title);
        const item = batchResults.find((batchItem) => batchItem?.title === paginatedResult.title);
        if (
          currentCount === undefined ||
          !item ||
          item.currentDepth >= depth ||
          currentCount >= pageLinkLimit
        ) continue;

        const remaining = pageLinkLimit - currentCount;
        const paginatedLinks = paginatedResult.links.slice(0, remaining);
        const nodeId = getCanonicalTitle(item.title, progress.resolvedTitles);

        for (let linkIndex = 0; linkIndex < paginatedLinks.length; linkIndex++) {
          const link = paginatedLinks[linkIndex];
          const normalizedLink = normalizeTitle(link);
          const canonicalLink = getCanonicalTitle(normalizedLink, progress.resolvedTitles);

          if (currentCount + linkIndex < MAX_EDGES_PER_NODE) {
            const edgeKey = `${nodeId}|${canonicalLink}`;
            if (!progress.edgeKeys.has(edgeKey)) {
              progress.edgeKeys.add(edgeKey);
              progress.edges.push({ source: nodeId, target: canonicalLink });
            }
          }

          if (
            !progress.visited.has(canonicalLink) &&
            progress.nodes.length < maxNodes &&
            shouldQueuePage(normalizedLink, progress.visited, queuedTitles)
          ) {
            progress.queue.push({ title: normalizedLink, depth: item.currentDepth + 1 });
            queuedTitles.add(normalizedLink);
          }
        }

        collectedLinks.set(paginatedResult.title, currentCount + paginatedLinks.length);
      }

      onBatch?.(
        [],
        progress.edges.filter((edge) => !batchEdgeKeys.has(`${edge.source}|${edge.target}`)),
      );
      for (const edge of progress.edges) {
        batchEdgeKeys.add(`${edge.source}|${edge.target}`);
      }

      continueToken = paginatedResponse.continueToken;
    }
  }

  // Keep only edges between pages that were actually crawled. This prevents
  // uncrawled link targets from inflating analysis and layout with leaf nodes.
  progress.edges = progress.edges.filter((edge) => (
    progress.nodeIds.has(edge.source) && progress.nodeIds.has(edge.target)
  ));

  // Calculate in-degrees
  const inDegreeMap = new Map<string, number>();
  for (const edge of progress.edges) {
    inDegreeMap.set(edge.target, (inDegreeMap.get(edge.target) || 0) + 1);
  }

  // Update in-degrees in nodes
  for (const node of progress.nodes) {
    node.inDegree = inDegreeMap.get(node.id) || 0;
  }

  const resolvedSeedId = getCanonicalTitle(seedTitle, progress.resolvedTitles);
  return {
    nodes: progress.nodes,
    edges: progress.edges,
    seedId: resolvedSeedId,
  };
}

export function buildGraph(nodes: WikiNode[], edges: WikiEdge[]): Graph {
  const graph = new Graph({ type: 'directed' });
  
  // Use a Set to track added nodes and avoid duplicates
  const addedNodes = new Set<string>();
  
  for (const node of nodes) {
    if (!addedNodes.has(node.id)) {
      graph.addNode(node.id, {
        title: node.title,
        url: node.url,
        extract: node.extract,
        depth: node.depth,
        pagerank: node.pagerank,
        betweenness: node.betweenness,
        communityId: node.communityId,
      });
      addedNodes.add(node.id);
    }
  }
  
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      if (!graph.hasEdge(edge.source, edge.target)) {
        try {
          graph.addEdge(edge.source, edge.target);
        } catch (e) {
          // Edge already exists, ignore
        }
      }
    }
  }
  
  return graph;
}
