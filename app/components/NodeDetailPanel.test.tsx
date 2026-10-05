// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import type { CrawlResult, WikiNode } from '@/types/graph';
import { MemoizedNodeDetailPanel } from './NodeDetailPanel';
import * as summaryModule from '@/lib/summary';
import * as relationshipModule from '@/lib/relationshipClient';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeNode(overrides: Partial<WikiNode> = {}): WikiNode {
  return {
    id: 'Quantum mechanics',
    title: 'Quantum mechanics',
    url: 'https://en.wikipedia.org/wiki/Quantum_mechanics',
    depth: 0,
    inDegree: 0,
    outDegree: 0,
    pagerank: 0.1,
    betweenness: 0,
    communityId: 0,
    ...overrides,
  };
}

function makeData(node: WikiNode): CrawlResult {
  return {
    id: 'test',
    seedId: node.id,
    nodes: [node],
    edges: [],
    communities: [],
    crawledAt: '',
    positions: {},
  };
}

describe('NodeDetailPanel summary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a skeleton while the summary is loading', async () => {
    vi.spyOn(summaryModule, 'fetchSummary').mockReturnValue(new Promise(() => {}));
    const node = makeNode();

    render(
      <MemoizedNodeDetailPanel node={node} data={makeData(node)} onClose={vi.fn()} onExpand={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('node-summary-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('node-summary-error')).not.toBeInTheDocument();
  });

  it('renders the thumbnail, description and extract once loaded', async () => {
    vi.spyOn(summaryModule, 'fetchSummary').mockResolvedValue({
      extract: 'Quantum mechanics is a fundamental theory in physics.',
      description: 'Theory of matter and energy',
      thumbnail: { source: 'https://example.test/thumb.jpg', width: 200, height: 100 },
    });
    const node = makeNode();

    render(
      <MemoizedNodeDetailPanel node={node} data={makeData(node)} onClose={vi.fn()} onExpand={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(screen.getByTestId('node-summary-extract'))
      .toHaveTextContent('Quantum mechanics is a fundamental theory in physics.'));
    expect(screen.getByText('Theory of matter and energy')).toBeInTheDocument();
    const thumbnail = screen.getByTestId('node-summary-thumbnail');
    const img = thumbnail.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.test/thumb.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('shows an error state when the summary fails to load', async () => {
    vi.spyOn(summaryModule, 'fetchSummary').mockRejectedValue(new Error('boom'));
    const node = makeNode();

    render(
      <MemoizedNodeDetailPanel node={node} data={makeData(node)} onClose={vi.fn()} onExpand={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(screen.getByTestId('node-summary-error')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByTestId('node-summary-skeleton')).not.toBeInTheDocument();
  });

  it('makes Explore deeper the primary node action', () => {
    const node = makeNode();
    const onExpand = vi.fn();

    render(
      <MemoizedNodeDetailPanel node={node} data={makeData(node)} onClose={vi.fn()} onExpand={onExpand} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByRole('button', { name: /Explore deeper/ }));
    expect(onExpand).toHaveBeenCalledWith(node.id);
  });

  it('loads a relationship on demand and progressively reveals its source passage', async () => {
    vi.spyOn(summaryModule, 'fetchSummary').mockResolvedValue({
      extract: 'A physicist.',
      description: null,
    });
    vi.spyOn(relationshipModule, 'fetchRelationship').mockResolvedValue({
      source: 'Albert Einstein',
      target: 'Theory of relativity',
      relation: 'developed',
      explanation: 'WikiCrawl interprets this passage as: Albert Einstein developed Theory of relativity.',
      evidence: 'Albert Einstein developed the theory of relativity.',
      section: 'Introduction',
      sourceUrl: 'https://en.wikipedia.org/wiki/Albert_Einstein',
      sourceContextFound: true,
    });
    const source = makeNode({ id: 'Albert Einstein', title: 'Albert Einstein' });
    const target = makeNode({ id: 'Theory of relativity', title: 'Theory of relativity' });
    const data: CrawlResult = {
      ...makeData(source),
      nodes: [source, target],
      edges: [{ source: source.id, target: target.id }],
    };

    render(
      <MemoizedNodeDetailPanel node={source} data={data} onClose={vi.fn()} onExpand={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Explain connection: Albert Einstein to Theory of relativity' }));
    expect(await screen.findByText('developed')).toBeInTheDocument();
    const sourcePassage = screen.getByText('View source passage · Introduction').closest('details');
    expect(sourcePassage).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('View source passage · Introduction'));
    expect(await screen.findByText('Albert Einstein developed the theory of relativity.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open source article on Wikipedia' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Albert_Einstein',
    );
  });
});
