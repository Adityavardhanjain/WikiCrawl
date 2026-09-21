// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { CrawlResult } from '@/types/graph';
import { GraphCanvas } from './GraphCanvas';

vi.mock('sigma', () => ({
  Sigma: class MockSigma {
    constructor() {}
    on() {}
    getCamera() {
      return {
        on() {},
        removeListener() {},
        getState: () => ({ ratio: 1 }),
        animate: vi.fn(),
        animatedReset: vi.fn(),
      };
    }
    getNodeDisplayData() { return undefined; }
    getDimensions() { return { width: 800, height: 600 }; }
    setCustomBBox() {}
    refresh() {}
    getContainer() { return document.createElement('div'); }
    setSetting() {}
    kill() {}
    graphToViewport(position: { x: number; y: number }) { return position; }
  },
}));

vi.mock('sigma/rendering', () => ({
  EdgeArrowProgram: class MockEdgeArrowProgram {},
  EdgeLineProgram: class MockEdgeLineProgram {},
}));

vi.mock('./useForceLayout', () => ({
  getRememberedPositions: () => undefined,
  seedInitialPositions: () => new Map(),
  useForceLayout: () => ({ arranging: false, paused: false, togglePause: vi.fn() }),
}));

vi.mock('./useNodeSummary', () => ({
  useNodeSummary: () => ({ data: null }),
  usePrefetchNodeSummary: () => vi.fn(),
}));

function makeData(): CrawlResult {
  return {
    id: 'test',
    seedId: 'A',
    nodes: [
      { id: 'A', title: 'A', url: '', depth: 0, inDegree: 1, outDegree: 1, pagerank: 0.5, betweenness: 0, communityId: 0 },
      { id: 'B', title: 'B', url: '', depth: 1, inDegree: 1, outDegree: 0, pagerank: 0.2, betweenness: 0, communityId: 0 },
    ],
    edges: [{ source: 'A', target: 'B' }],
    communities: [],
    crawledAt: '',
    positions: {},
  };
}

describe('GraphCanvas DOM ownership', () => {
  afterEach(() => cleanup());

  it('keeps React overlays outside the Sigma container', () => {
    const { container } = render(
      <StrictMode>
        <GraphCanvas data={makeData()} colorMode="community" onNodeClick={vi.fn()} focusedNode={null} path={null} />
      </StrictMode>,
    );

    const sigmaContainer = container.querySelector('.graph-surface');
    expect(sigmaContainer).toBeInTheDocument();
    expect(sigmaContainer).toBeEmptyDOMElement();
    expect(sigmaContainer).not.toContainElement(screen.getByRole('button', { name: 'Zoom in' }));
    expect(sigmaContainer).not.toContainElement(screen.getByText('Exploration map'));
  });
});