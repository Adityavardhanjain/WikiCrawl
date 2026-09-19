import Graph from 'graphology';
import { getPageLinksBatch, titleToUrl } from './wikipedia';
import { isJunkTitle } from './filters';
import type { CrawlProgress, WikiNode, WikiEdge } from '@/types/graph';

const WIKIPEDIA_BATCH_SIZE = 8;
const PAGE_LINK_LIMIT: number | undefined = undefined;
const MAX_REQUEST_BUDGET = 500;

interface CrawlState {
  nodes: WikiNode[];
  nodeIds: Set<string>;
  linksByNode: Map<string, string[]>;
  visited: Set<string>;
  queue: { title: string; depth: number }[];
  resolvedTitles: Map<string, string>;
  failedTitles: Set<string>;
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
  if (isJunkTitle(normalized)) return false;
  if (visited.has(normalized) || queued.has(normalized)) return false;
  return true;
}

function normalizeTitle(title: string): string {
  return title.replace(/_/g, ' ').trim();
}

function getCanonicalTitle(title: string, resolvedTitles: Map<string, string>): string {
  let canonical = normalizeTitle(title);
  const seen = new Set<string>();
  while (resolvedTitles.has(canonical) && !seen.has(canonical)) {
    seen.add(canonical);
    canonical = normalizeTitle(resolvedTitles.get(canonical)!);
  }
  return canonical;
}

export interface CrawlOptions {
  seedTitle: string;
  depth: number;
  maxNodes: number;
  onProgress?: (progress: CrawlProgress) => void;
  onBatch?: (nodes: WikiNode[], edges: WikiEdge[]) => void;
}

export async function crawlWikipedia(options: CrawlOptions): Promise<{
  nodes: WikiNode[];
  edges: WikiEdge[];
  seedId: string;
  partial: boolean;
  failedTitles: string[];
}> {
  const { seedTitle, depth, maxNodes, onProgress, onBatch } = options;
  const requestBudget = getCrawlRequestBudget(maxNodes, depth);
  const progress: CrawlState = {
    nodes: [],
    nodeIds: new Set(),
    linksByNode: new Map(),
    visited: new Set(),
    queue: [],
    resolvedTitles: new Map(),
    failedTitles: new Set(),
  };

  const queuedTitles = new Set<string>();

  // Start with the seed page
  const seedNormalized = normalizeTitle(seedTitle);
  if (!isJunkTitle(seedNormalized)) {
    progress.queue.push({ title: seedNormalized, depth: 0 });
    queuedTitles.add(seedNormalized);
  }

  let progressTarget = 1;
  let activeWork = 0;
  let requestsUsed = 0;

  const emitProgress = (complete = false) => {
    const done = progress.nodes.length;
    const knownWork = done + activeWork + progress.queue.length;
    progressTarget = complete
      ? done
      : Math.min(maxNodes, Math.max(progressTarget, done, knownWork));
    onProgress?.({ done, target: Math.max(progressTarget, done) });
  };

  while (progress.queue.length > 0 && progress.nodes.length < maxNodes && requestsUsed < requestBudget) {
    const batchSize = Math.min(WIKIPEDIA_BATCH_SIZE, progress.queue.length, requestBudget - requestsUsed);
    const batch = progress.queue.splice(0, batchSize);
    if (batch.length === 0) break;
    activeWork = batch.length;

    const batchTitles = batch.map(({ title }) => title);
    const fetchBatch = async (continueToken?: string) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await getPageLinksBatch(batchTitles, continueToken);
          requestsUsed += 1;
          return response;
        } catch {
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      for (const title of batchTitles) progress.failedTitles.add(title);
      return null;
    };

    const batchResponse = await fetchBatch();
    if (!batchResponse) {
      activeWork = 0;
      continue;
    }

    const batchNodeIds = new Set(progress.nodes.map((node) => node.id));
    for (const page of batchResponse.pages) {
      const normalizedTitle = normalizeTitle(page.title);
      const resolvedTitle = normalizeTitle(page.resolvedTitle);
      if (resolvedTitle !== normalizedTitle) progress.resolvedTitles.set(normalizedTitle, resolvedTitle);
    }
    const batchResults = batch.map(({ title, depth: currentDepth }) => {
      const canonicalTitle = getCanonicalTitle(title, progress.resolvedTitles);
      const result = batchResponse.pages.find((page) => page.title === title);
      if (progress.visited.has(canonicalTitle) || !result) {
        return null;
      }

      if (result.missing) {
        return null;
      }

      return { title, currentDepth, result, canonicalTitle };
    });

    const collectedLinks = new Map<string, number>();
    const batchCanonicalTitles = new Set<string>();

    for (const item of batchResults) {
      if (!item) {
        activeWork -= 1;
        continue;
      }

      const { title, currentDepth, result, canonicalTitle } = item;
      if (progress.visited.has(canonicalTitle) || batchCanonicalTitles.has(canonicalTitle)) {
        activeWork -= 1;
        continue;
      }

      batchCanonicalTitles.add(canonicalTitle);
      progress.visited.add(canonicalTitle);
      const links = PAGE_LINK_LIMIT === undefined ? result.links : result.links.slice(0, PAGE_LINK_LIMIT);
      collectedLinks.set(title, links.length);
      const nodeId = canonicalTitle;
      progress.linksByNode.set(nodeId, [...(progress.linksByNode.get(nodeId) ?? []), ...links.map(normalizeTitle)]);

      if (!progress.nodeIds.has(nodeId)) {
        progress.nodes.push({
          id: nodeId,
          title: nodeId,
          url: titleToUrl(nodeId),
          extract: '',
          depth: currentDepth,
          inDegree: 0,
          outDegree: 0,
          pagerank: 0,
          betweenness: 0,
          communityId: 0,
        });
        progress.nodeIds.add(nodeId);
      }

      if (currentDepth < depth) {
        for (const link of links) {
          const normalizedLink = normalizeTitle(link);
          const canonicalLink = getCanonicalTitle(normalizedLink, progress.resolvedTitles);
          if (
            !isJunkTitle(normalizedLink) &&
            !progress.visited.has(canonicalLink) &&
            progress.nodes.length < maxNodes &&
            shouldQueuePage(normalizedLink, progress.visited, queuedTitles)
          ) {
            progress.queue.push({ title: normalizedLink, depth: currentDepth + 1 });
            queuedTitles.add(normalizedLink);
          }
        }
      }

      activeWork -= 1;
      emitProgress();

    }

    onBatch?.(progress.nodes.filter((node) => !batchNodeIds.has(node.id)), []);

    let continueToken = batchResponse.continueToken;
    while (
      continueToken &&
      progress.nodes.length < maxNodes &&
      requestsUsed < requestBudget &&
      batchResults.some((item) => item !== null && item.currentDepth < depth) &&
      (PAGE_LINK_LIMIT === undefined || Array.from(collectedLinks.values()).some((count) => count < PAGE_LINK_LIMIT))
    ) {
      const paginatedResponse = await fetchBatch(continueToken);
      if (!paginatedResponse) {
        break;
      }

      for (const paginatedResult of paginatedResponse.pages) {
        const currentCount = collectedLinks.get(paginatedResult.title);
        const item = batchResults.find((batchItem) => batchItem?.title === paginatedResult.title);
        if (
          currentCount === undefined ||
          !item ||
          item.currentDepth >= depth ||
          (PAGE_LINK_LIMIT !== undefined && currentCount >= PAGE_LINK_LIMIT)
        ) continue;

        const remaining = PAGE_LINK_LIMIT === undefined ? paginatedResult.links.length : PAGE_LINK_LIMIT - currentCount;
        if (remaining <= 0) continue;
        const paginatedLinks = paginatedResult.links.slice(0, remaining);
        const nodeId = getCanonicalTitle(item.title, progress.resolvedTitles);
        progress.linksByNode.set(nodeId, [
          ...(progress.linksByNode.get(nodeId) ?? []),
          ...paginatedLinks.map(normalizeTitle),
        ]);

        for (const link of paginatedLinks) {
          const normalizedLink = normalizeTitle(link);
          const canonicalLink = getCanonicalTitle(normalizedLink, progress.resolvedTitles);

          if (
            !isJunkTitle(normalizedLink) &&
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

      continueToken = paginatedResponse.continueToken;
    }
  }

  const edgeKeys = new Set<string>();
  const edges: WikiEdge[] = [];
  for (const [source, links] of progress.linksByNode) {
    if (isJunkTitle(source)) continue;
    for (const link of links) {
      const target = getCanonicalTitle(link, progress.resolvedTitles);
      if (isJunkTitle(target) || !progress.nodeIds.has(target)) continue;
      const edgeKey = `${source}|${target}`;
      if (source !== target && !edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push({ source, target });
      }
    }
  }
  for (const node of progress.nodes) {
    node.outDegree = edges.filter((edge) => edge.source === node.id).length;
  }
  onBatch?.([], edges);

  if (progress.queue.length === 0) {
    emitProgress(true);
  }

  // Calculate in-degrees
  const inDegreeMap = new Map<string, number>();
  for (const edge of edges) {
    inDegreeMap.set(edge.target, (inDegreeMap.get(edge.target) || 0) + 1);
  }

  // Update in-degrees in nodes
  for (const node of progress.nodes) {
    node.inDegree = inDegreeMap.get(node.id) || 0;
  }

  const resolvedSeedId = getCanonicalTitle(seedTitle, progress.resolvedTitles);
  return {
    nodes: progress.nodes,
    edges,
    seedId: resolvedSeedId,
    partial: progress.failedTitles.size > 0,
    failedTitles: [...progress.failedTitles],
  };
}

export function sanitizeGraphData(nodes: WikiNode[], edges: WikiEdge[]): { nodes: WikiNode[]; edges: WikiEdge[] } {
  const validNodeIds = new Set(nodes.filter((node) => node && node.id).map((node) => node.id));
  const dedupedNodes = Array.from(new Map(nodes.filter((node) => node && node.id).map((node) => [node.id, node])).values());
  const validEdges = edges.filter((edge) => {
    if (!edge) return false;
    if (!edge.source || !edge.target) return false;
    if (edge.source === edge.target) return false;
    return validNodeIds.has(edge.source) && validNodeIds.has(edge.target);
  });

  return { nodes: dedupedNodes, edges: validEdges };
}

export function buildGraph(nodes: WikiNode[], edges: WikiEdge[]): Graph {
  const { nodes: validNodes, edges: validEdges } = sanitizeGraphData(nodes, edges);
  const graph = new Graph({ type: 'directed' });
  
  const addedNodes = new Set<string>();
  
  for (const node of validNodes) {
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
  
  for (const edge of validEdges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      if (!graph.hasEdge(edge.source, edge.target)) {
        try {
          graph.addEdge(edge.source, edge.target);
        } catch {
          // Edge already exists, ignore
        }
      }
    }
  }
  
  return graph;
}
