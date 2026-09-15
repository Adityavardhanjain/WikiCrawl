import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

export interface LayoutOptions {
  iterations?: number;
  settings?: Record<string, unknown>;
  fixedNodes?: Set<string>;
}

const DEFAULT_SETTINGS = {
  gravity: 1,
  scalingRatio: 10,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  strongGravityMode: false,
  slowDown: 5,
  outboundAttractionDistribution: false,
  adjustSizes: false,
  linLogMode: false,
  edgeWeightInfluence: 0.5,
};

export function computeLayout(
  graph: Graph,
  options: LayoutOptions = {}
): { [key: string]: { x: number; y: number } } {
  const nodeCount = graph.order;
  const {
    iterations = Math.min(100, Math.max(40, 120 - nodeCount / 3)),
    settings = {},
    fixedNodes,
  } = options;

  const layoutSettings = { ...DEFAULT_SETTINGS, ...settings };

  if (nodeCount === 0) {
    return {};
  }

  if (nodeCount <= 20) {
    const positions: { [key: string]: { x: number; y: number } } = {};
    graph.forEachNode((node) => {
      const x = graph.getNodeAttribute(node, 'x');
      const y = graph.getNodeAttribute(node, 'y');
      positions[node] = fixedNodes?.has(node) && typeof x === 'number' && typeof y === 'number'
        ? { x, y }
        : { x: Math.random() * 800, y: Math.random() * 600 };
    });
    return positions;
  }

  graph.forEachNode((node) => {
    if (!graph.getNodeAttribute(node, 'x')) {
      graph.setNodeAttribute(node, 'x', Math.random() * 1000);
      graph.setNodeAttribute(node, 'y', Math.random() * 800);
    }
    if (fixedNodes?.has(node)) {
      graph.setNodeAttribute(node, 'fixed', true);
    }
  });

  forceAtlas2.assign(graph, {
    iterations,
    settings: layoutSettings,
  });

  // Extract positions from graph
  const positions: { [key: string]: { x: number; y: number } } = {};
  graph.forEachNode((node) => {
    positions[node] = {
      x: graph.getNodeAttribute(node, 'x') as number,
      y: graph.getNodeAttribute(node, 'y') as number,
    };
  });

  return positions;
}

export function normalizeLayout(
  positions: { [key: string]: { x: number; y: number } },
  width: number = 1000,
  height: number = 800,
  padding: number = 50
): { [key: string]: { x: number; y: number } } {
  if (Object.keys(positions).length === 0) {
    return positions;
  }

  // Find bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const pos of Object.values(positions)) {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y);
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const availableWidth = width - 2 * padding;
  const availableHeight = height - 2 * padding;
  const scale = Math.min(availableWidth / rangeX, availableHeight / rangeY);

  // Normalize and center
  const result: { [key: string]: { x: number; y: number } } = {};
  const centerX = width / 2;
  const centerY = height / 2;

  for (const [nodeId, pos] of Object.entries(positions)) {
    result[nodeId] = {
      x: centerX + (pos.x - (minX + maxX) / 2) * scale,
      y: centerY + (pos.y - (minY + maxY) / 2) * scale,
    };
  }

  return result;
}
