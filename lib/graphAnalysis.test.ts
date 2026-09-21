import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import { getShortestPath, findShortestPath } from './graphAnalysis';

function makeGraph() {
  const graph = new Graph({ type: 'directed' });
  for (const node of ['A', 'B', 'C', 'D', 'E']) graph.addNode(node);
  graph.addEdge('A', 'B');
  graph.addEdge('B', 'C');
  graph.addEdge('D', 'A');
  return graph;
}

describe('shortest paths', () => {
  it('finds direct and multi-hop paths in either direction', () => {
    const graph = makeGraph();

    expect(getShortestPath(graph, 'A', 'B')).toEqual({ path: ['A', 'B'], length: 1 });
    expect(getShortestPath(graph, 'C', 'A')).toEqual({ path: ['C', 'B', 'A'], length: 2 });
  });

  it('returns null when nodes are disconnected or missing', () => {
    const graph = makeGraph();

    expect(getShortestPath(graph, 'A', 'C')).not.toBeNull();
    expect(getShortestPath(graph, 'C', 'E')).toBeNull();
    expect(getShortestPath(graph, 'A', 'missing')).toBeNull();
  });

  it('does not mutate the source graph', () => {
    const graph = makeGraph();
    const before = { nodes: graph.nodes(), edges: graph.edges() };

    expect(getShortestPath(graph, 'A', 'D')).toEqual({ path: ['A', 'D'], length: 1 });
    expect(graph.nodes()).toEqual(before.nodes);
    expect(graph.edges()).toEqual(before.edges);
    expect(graph.type).toBe('directed');
  });
});