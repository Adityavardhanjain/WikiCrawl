export interface CrawlRequest {
  seed: string;
  depth: number;
  maxNodes: number;
  nonce: number;
}

export const DEFAULT_DEPTH = 3;
export const DEFAULT_MAX_NODES = 500;

function parseBoundedNumber(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function parseCrawlParams(search: string): { seed: string | null; depth: number; maxNodes: number } {
  const params = new URLSearchParams(search);
  return {
    seed: params.get('seed'),
    depth: parseBoundedNumber(params.get('depth'), DEFAULT_DEPTH, 1, 3),
    maxNodes: parseBoundedNumber(params.get('nodes'), DEFAULT_MAX_NODES, 50, 500),
  };
}

export function createCrawlRequest(seed: string, depth: number, maxNodes: number, nonce: number): CrawlRequest {
  return { seed, depth, maxNodes, nonce };
}

export function getCrawlPayload(request: CrawlRequest): { seedTitle: string; depth: number; maxNodes: number } {
  return {
    seedTitle: request.seed,
    depth: request.depth,
    maxNodes: request.maxNodes,
  };
}