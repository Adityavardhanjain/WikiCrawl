import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { CrawlResult, WikiNode } from '@/types/graph';
import { positionNearNeighbors, seedInitialPositions } from './layoutSeed';

function node(id: string, communityId: number): WikiNode {
  return {
    id,
    title: id,
    url: id,
    depth: communityId,
    inDegree: 0,
    outDegree: 0,
    pagerank: 0.1,
    betweenness: 0,
    communityId,
  };
}

function edge(source: string, target: string): CrawlResult['edges'][number] {
  return { source, target };
}

describe('layoutSeed', () => {
  it('is deterministic and keeps community members closer than separate communities', () => {
    const nodes = [
      node('seed', 0), node('a', 0), node('b', 0),
      node('c', 1), node('d', 1), node('e', 1),
    ];
    const edges = [edge('seed', 'a'), edge('a', 'b'), edge('c', 'd'), edge('d', 'e')];
    const first = seedInitialPositions(nodes, 'seed');
    const second = seedInitialPositions(nodes, 'seed');

    expect([...first.entries()]).toEqual([...second.entries()]);
    const intra = distance(first.get('a')!, first.get('b')!);
    const inter = distance(first.get('a')!, first.get('d')!);
    expect(intra).toBeLessThan(inter);
  });

  it('places a new node near its placed neighbors', () => {
    const positions = new Map([
      ['seed', { x: 100, y: 100 }],
      ['neighbor', { x: 120, y: 100 }],
    ]);
    const placed = positionNearNeighbors(
      'new',
      [edge('neighbor', 'new')],
      positions,
      'seed',
    );
    expect(Math.hypot(placed.x - 120, placed.y - 100)).toBeLessThan(20);
  });

  it('produces a compact clustered FA2 layout with gravity', () => {
    const graph = new Graph({ type: 'undirected' });
    const nodes = Array.from({ length: 41 }, (_, index) => node(`node-${index}`, index < 20 ? 0 : index === 40 ? 2 : 1));
    const positions = seedInitialPositions(nodes, 'node-0');
    for (const current of nodes) {
      const position = positions.get(current.id)!;
      graph.addNode(current.id, { ...position, size: 1, communityId: current.communityId });
    }
    for (let index = 0; index < 20; index += 1) {
      for (let offset = 1; offset <= 3; offset += 1) {
        graph.addEdge(`node-${index}`, `node-${(index + offset) % 20}`);
        graph.addEdge(`node-${20 + index}`, `node-${20 + ((index + offset) % 20)}`);
      }
    }
    graph.addEdge('node-0', 'node-20');

    forceAtlas2.assign(graph, {
      iterations: 180,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        barnesHutOptimize: true,
        scalingRatio: 10,
        gravity: 0.5,
        strongGravityMode: false,
        slowDown: 5,
      },
    });

    const extent = graph.nodes().reduce((maximum, current) => {
      const attributes = graph.getNodeAttributes(current);
      return Math.max(maximum, Math.abs(attributes.x), Math.abs(attributes.y));
    }, 0);
    const intra: number[] = [];
    const inter: number[] = [];
    graph.forEachEdge((_, __, source, target) => {
      const sourcePosition = graph.getNodeAttributes(source);
      const targetPosition = graph.getNodeAttributes(target);
      const length = Math.hypot(sourcePosition.x - targetPosition.x, sourcePosition.y - targetPosition.y);
      (sourcePosition.communityId === targetPosition.communityId ? intra : inter).push(length);
    });

    expect(extent).toBeLessThan(5000);
    expect(average(intra) / average(inter)).toBeLessThan(0.5);
  });
});

function distance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
