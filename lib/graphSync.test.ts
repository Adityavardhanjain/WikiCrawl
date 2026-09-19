import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import type { CrawlResult, WikiNode } from '@/types/graph';
import { mergeGraphData, syncGraphData, updateGraphColors } from './graphSync';

function node(id: string, depth = 1): WikiNode {
  return {
    id,
    title: id,
    url: `https://example.test/${id}`,
    extract: '',
    depth,
    inDegree: 0,
    outDegree: 0,
    pagerank: 0.1,
    betweenness: 0,
    communityId: 0,
  };
}

function data(nodes: WikiNode[], edges: CrawlResult['edges'] = []): CrawlResult {
  return {
    id: 'test',
    seedId: 'seed',
    nodes,
    edges,
    communities: [],
    crawledAt: '',
    positions: {},
  };
}

const options = {
  colorForNode: () => '#fff',
  sizeForNode: () => 8,
};

describe('syncGraphData', () => {
  it('preserves existing edges when merging an expansion result', () => {
    const base = data(
      [node('seed'), node('old'), node('new')],
      [{ source: 'seed', target: 'old' }, { source: 'old', target: 'new' }],
    );
    const update = data(
      [node('new', 2), node('another', 2)],
      [{ source: 'new', target: 'another' }],
    );

    const merged = mergeGraphData(base, update);

    expect(merged.edges).toEqual([
      { source: 'seed', target: 'old' },
      { source: 'old', target: 'new' },
      { source: 'new', target: 'another' },
    ]);
    expect(merged.nodes.map((candidate) => candidate.id)).toEqual(['seed', 'old', 'new', 'another']);
    expect(merged.nodes.find((candidate) => candidate.id === 'new')?.depth).toBe(2);
  });

  it('adds nodes without moving existing nodes and drops removed nodes', () => {
    const graph = new Graph({ type: 'directed' });
    syncGraphData(graph, data([node('seed'), node('old')], [{ source: 'seed', target: 'old' }]), options);
    graph.setNodeAttribute('old', 'x', 123);
    graph.setNodeAttribute('old', 'y', -45);

    syncGraphData(graph, data([node('seed'), node('old'), node('new')], [{ source: 'seed', target: 'new' }]), options);

    expect(graph.hasNode('new')).toBe(true);
    expect(graph.getNodeAttribute('old', 'x')).toBe(123);
    expect(graph.getNodeAttribute('old', 'y')).toBe(-45);
    expect(graph.hasNode('old')).toBe(true);
    expect(graph.hasEdge('seed', 'old')).toBe(false);

    syncGraphData(graph, data([node('seed'), node('new')]), options);
    expect(graph.hasNode('old')).toBe(false);
  });

  it('recolors without changing positions', () => {
    const graph = new Graph({ type: 'directed' });
    syncGraphData(graph, data([node('seed'), node('new')]), options);
    graph.setNodeAttribute('new', 'x', 42);
    graph.setNodeAttribute('new', 'y', 24);

    updateGraphColors(graph, data([node('seed'), node('new')]), () => '#123456');

    expect(graph.getNodeAttribute('new', 'color')).toBe('#123456');
    expect(graph.getNodeAttribute('new', 'x')).toBe(42);
    expect(graph.getNodeAttribute('new', 'y')).toBe(24);
  });
});
