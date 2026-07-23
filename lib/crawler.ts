import Graph from 'graphology';
import { getPageLinks, titleToUrl } from './wikipedia';
import type { WikiNode, WikiEdge } from '@/types/graph';

interface CrawlProgress {
  nodes: WikiNode[];
  edges: WikiEdge[];
  visited: Set<string>;
  queue: { title: string; depth: number }[];
  resolvedTitles: Map<string, string>;
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
  
  const progress: CrawlProgress = {
    nodes: [],
    edges: [],
    visited: new Set(),
    queue: [],
    resolvedTitles: new Map(),
  };

  // Start with the seed page
  progress.queue.push({ title: normalizeTitle(seedTitle), depth: 0 });
  
  let visited = 0;

  while (progress.queue.length > 0 && progress.nodes.length < maxNodes) {
    const { title, depth: currentDepth } = progress.queue.shift()!;
    const canonicalTitle = getCanonicalTitle(title, progress.resolvedTitles);

    // Skip if already visited (using canonical title)
    if (progress.visited.has(canonicalTitle)) {
      continue;
    }

    progress.visited.add(canonicalTitle);
    visited++;

    if (onProgress) {
      onProgress(visited, progress.nodes.length);
    }

    // Fetch links from this page
    const result = await getPageLinks(title);
    
    // Store the resolved title mapping
    if (result.resolvedTitle !== normalizeTitle(title)) {
      progress.resolvedTitles.set(normalizeTitle(title), result.resolvedTitle);
    }

    const links = result.links.slice(0, maxNodes - progress.nodes.length);
    
    // Add node
    const nodeId = getCanonicalTitle(title, progress.resolvedTitles);
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
    
    // Store nodeId to avoid issues with getCanonicalTitle returning undefined
    void nodeId; // Mark as intentionally unused here

    // Add edges and queue new pages
    if (currentDepth < depth) {
      for (const link of links) {
        const normalizedLink = normalizeTitle(link);
        const canonicalLink = getCanonicalTitle(normalizedLink, progress.resolvedTitles);
        
        // Add edge (avoid duplicates)
        const edgeKey = `${nodeId}|${canonicalLink}`;
        if (!progress.edges.some(e => e.source === nodeId && e.target === canonicalLink)) {
          progress.edges.push({
            source: nodeId,
            target: canonicalLink,
          });
        }

        // Queue if not visited
        if (!progress.visited.has(canonicalLink) && progress.nodes.length < maxNodes) {
          // Check if already in queue
          if (!progress.queue.some(q => normalizeTitle(q.title) === normalizedLink)) {
            progress.queue.push({ title: normalizedLink, depth: currentDepth + 1 });
          }
        }
      }
    }

    // Handle pagination
    if (result.continueToken && currentDepth < depth && progress.nodes.length < maxNodes) {
      // Continue fetching from this page with pagination
      let continueToken: string | undefined = result.continueToken;
      while (continueToken && progress.nodes.length < maxNodes) {
        const paginatedResult = await getPageLinks(title, continueToken);
        const paginatedLinks = paginatedResult.links.slice(0, maxNodes - progress.nodes.length);
        
        for (const link of paginatedLinks) {
          const normalizedLink = normalizeTitle(link);
          const canonicalLink = getCanonicalTitle(normalizedLink, progress.resolvedTitles);
          
          if (!progress.edges.some(e => e.source === nodeId && e.target === canonicalLink)) {
            progress.edges.push({
              source: nodeId,
              target: canonicalLink,
            });
          }

          if (!progress.visited.has(canonicalLink) && progress.nodes.length < maxNodes) {
            if (!progress.queue.some(q => normalizeTitle(q.title) === normalizedLink)) {
              progress.queue.push({ title: normalizedLink, depth: currentDepth + 1 });
            }
          }
        }
        
        continueToken = paginatedResult.continueToken || undefined;
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
