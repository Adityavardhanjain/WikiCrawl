import Graph from 'graphology';
import { getPageLinks, titleToUrl } from './wikipedia';
import type { WikiNode, WikiEdge } from '@/types/graph';

const CONCURRENCY = 8;
const MAX_REQUEST_BUDGET = 500;

interface CrawlProgress {
  nodes: WikiNode[];
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
}

export async function crawlWikipedia(options: CrawlOptions): Promise<{
  nodes: WikiNode[];
  edges: WikiEdge[];
  seedId: string;
}> {
  const { seedTitle, depth, maxNodes, onProgress } = options;

  const requestBudget = getCrawlRequestBudget(maxNodes, depth);
  const pageLinkLimit = Math.min(300, Math.max(120, maxNodes));

  const progress: CrawlProgress = {
    nodes: [],
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
    const batchSize = Math.min(CONCURRENCY, progress.queue.length, requestBudget - requestsUsed);
    const batch = progress.queue.splice(0, batchSize);
    if (batch.length === 0) break;

    const batchResults = await Promise.all(
      batch.map(async ({ title, depth: currentDepth }) => {
        const canonicalTitle = getCanonicalTitle(title, progress.resolvedTitles);
        if (progress.visited.has(canonicalTitle)) {
          return null;
        }

        try {
          const result = await getPageLinks(title);
          requestsUsed += 1;
          return { title, currentDepth, result, canonicalTitle };
        } catch {
          return null;
        }
      })
    );

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
      const nodeId = getCanonicalTitle(title, progress.resolvedTitles);

      const existingNode = progress.nodes.find((node) => node.id === nodeId);
      if (!existingNode) {
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
      }

      if (currentDepth < depth) {
        for (const link of links) {
          const normalizedLink = normalizeTitle(link);
          const canonicalLink = getCanonicalTitle(normalizedLink, progress.resolvedTitles);

          const edgeKey = `${nodeId}|${canonicalLink}`;
          if (!progress.edgeKeys.has(edgeKey)) {
            progress.edgeKeys.add(edgeKey);
            progress.edges.push({
              source: nodeId,
              target: canonicalLink,
            });
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

      if (result.continueToken && currentDepth < depth && progress.nodes.length < maxNodes && requestsUsed < requestBudget) {
        let continueToken: string | undefined = result.continueToken;
        let collectedLinks = links.length;

        while (
          continueToken &&
          progress.nodes.length < maxNodes &&
          requestsUsed < requestBudget &&
          collectedLinks < pageLinkLimit
        ) {
          try {
            const paginatedResult = await getPageLinks(title, continueToken);
            requestsUsed += 1;
            const paginatedLinks = paginatedResult.links.slice(0, Math.min(pageLinkLimit - collectedLinks, paginatedResult.links.length));

            for (const link of paginatedLinks) {
              const normalizedLink = normalizeTitle(link);
              const canonicalLink = getCanonicalTitle(normalizedLink, progress.resolvedTitles);

              const edgeKey = `${nodeId}|${canonicalLink}`;
              if (!progress.edgeKeys.has(edgeKey)) {
                progress.edgeKeys.add(edgeKey);
                progress.edges.push({
                  source: nodeId,
                  target: canonicalLink,
                });
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

            collectedLinks += paginatedLinks.length;
            continueToken = paginatedResult.continueToken || undefined;
          } catch {
            break;
          }
        }
      }
    }
  }

  // Calculate in-degrees
  const inDegreeMap = new Map<string, number>();
  for (const edge of progress.edges) {
    inDegreeMap.set(edge.target, (inDegreeMap.get(edge.target) || 0) + 1);
  }

  // Update in-degrees in nodes
  for (const node of progress.nodes) {
    node.inDegree = inDegreeMap.get(node.id) || 0;
  }

  // Add missing nodes for edges (in case they weren't crawled)
  const nodeIds = new Set(progress.nodes.map(n => n.id));
  for (const edge of progress.edges) {
    if (!nodeIds.has(edge.target)) {
      progress.nodes.push({
        id: edge.target,
        title: edge.target,
        url: titleToUrl(edge.target),
        extract: '',
        depth: -1, // Unknown depth
        inDegree: 0,
        outDegree: 0,
        pagerank: 0,
        betweenness: 0,
        communityId: 0,
      });
      nodeIds.add(edge.target);
    }
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
