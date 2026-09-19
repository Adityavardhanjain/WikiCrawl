import type Graph from 'graphology';
import type { CrawlResult, WikiNode } from '@/types/graph';
import { positionNearNeighbors } from './layoutSeed';

export function mergeGraphData(base: CrawlResult, update: CrawlResult): CrawlResult {
  const nodes = new Map(base.nodes.map((node) => [node.id, node]));
  for (const node of update.nodes) {
    nodes.set(node.id, { ...nodes.get(node.id), ...node });
  }

  const edges = new Map(base.edges.map((edge) => [`${edge.source}|${edge.target}`, edge]));
  for (const edge of update.edges) {
    edges.set(`${edge.source}|${edge.target}`, edge);
  }

  return {
    ...base,
    ...update,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    positions: { ...base.positions, ...update.positions },
  };
}

interface GraphNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  raw: WikiNode;
  isSeed: boolean;
}

export interface GraphSyncOptions {
  colorForNode: (node: WikiNode) => string;
  sizeForNode: (node: WikiNode) => number;
  initialPositions?: Map<string, { x: number; y: number }>;
}

export interface GraphSyncResult {
  seedChanged: boolean;
  addedNodeIds: string[];
  shouldFitCamera: boolean;
}

export function syncGraphData(
  graph: Graph,
  data: CrawlResult,
  options: GraphSyncOptions,
): GraphSyncResult {
  const seedChanged = graph.order > 0 && graph.getAttribute('seedId') !== data.seedId;
  const wasEmpty = graph.order === 0;
  if (seedChanged) {
    graph.clear();
  }
  graph.setAttribute('seedId', data.seedId);

  const incomingIds = new Set(data.nodes.map((node) => node.id));
  const addedNodeIds: string[] = [];

  for (const node of data.nodes) {
    const isSeed = node.id === data.seedId;
    const size = options.sizeForNode(node) * (isSeed ? 1.3 : 1);
    const color = options.colorForNode(node);
    const existing = graph.hasNode(node.id);

    if (existing) {
      graph.updateNodeAttributes(node.id, (attributes) => ({
        ...attributes,
        size,
        color,
        label: node.title,
        raw: node,
        isSeed,
      }));
      continue;
    }

    const currentPositions = new Map(
      graph.nodes().map((nodeId) => {
        const attributes = graph.getNodeAttributes(nodeId);
        return [nodeId, { x: attributes.x as number, y: attributes.y as number }];
      }),
    );
    const position = options.initialPositions?.get(node.id)
      ?? positionNearNeighbors(node.id, data.edges, currentPositions, data.seedId);
    graph.mergeNode(node.id, {
      x: position.x,
      y: position.y,
      size,
      color,
      label: node.title,
      raw: node,
      isSeed,
    } satisfies GraphNodeAttributes);
    addedNodeIds.push(node.id);
  }

  for (const node of graph.nodes()) {
    if (!incomingIds.has(node)) graph.dropNode(node);
  }

  const incomingEdges = new Set<string>();
  for (const edge of data.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    const key = `${edge.source}|${edge.target}`;
    incomingEdges.add(key);
    graph.mergeEdge(edge.source, edge.target, {
      size: 0.8,
      color: 'rgba(148, 163, 184, 0.22)',
      type: 'line',
    });
  }

  for (const edge of graph.edges()) {
    const [source, target] = graph.extremities(edge);
    if (!incomingEdges.has(`${source}|${target}`)) graph.dropEdge(edge);
  }

  return { seedChanged, addedNodeIds, shouldFitCamera: seedChanged || (wasEmpty && addedNodeIds.length > 0) };
}

export function updateGraphColors(
  graph: Graph,
  data: CrawlResult,
  colorForNode: (node: WikiNode) => string,
): void {
  graph.updateEachNodeAttributes((nodeId, attributes) => {
    const node = data.nodes.find((candidate) => candidate.id === nodeId);
    return node ? { ...attributes, color: colorForNode(node) } : attributes;
  });
}

