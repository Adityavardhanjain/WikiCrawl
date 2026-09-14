export interface WikiNode {
  id: string;
  title: string;
  url: string;
  extract: string;
  depth: number;
  inDegree: number;
  outDegree: number;
  pagerank: number;
  betweenness: number;
  communityId: number;
}

export interface WikiEdge {
  source: string;
  target: string;
}

export interface Community {
  id: number;
  label: string;
  size: number;
  topPages: string[];
}

export interface CrawlResult {
  id: string;
  seedId: string;
  nodes: WikiNode[];
  edges: WikiEdge[];
  communities: Community[];
  crawledAt: string;
  positions: { [key: string]: { x: number; y: number } };
  progress?: {
    visited: number;
    total: number;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  extract?: string;
}

export interface PathResult {
  path: string[];
  length: number;
}

export interface CrawlRequest {
  seedTitle: string;
  depth: number;
  maxNodes: number;
  baseGraph?: CrawlResult;
}
