// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WikiNode } from '@/types/graph';
vi.mock('./components/useNodeSummary', () => ({
  useNodeSummary: () => ({
    data: {
      extract: 'Test summary',
      description: 'Test page',
    },
    isLoading: false,
    isError: false,
  }),
}));
import Home from './page';

// Keep the dynamically imported WebGL canvas out of jsdom.
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockDynamicComponent() { return null; },
}));

function makeNode(id: string): WikiNode {
  return { id, title: id, url: '', depth: 0, inDegree: 0, outDegree: 0, pagerank: 0.1, betweenness: 0, communityId: 0 };
}

interface SseChannel {
  emit: (event: string, data: unknown) => void;
  close: () => void;
}

function createSseChannel(): SseChannel & { response: Response } {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  return {
  response: new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  }),

  emit(event, data) {
    controller.enqueue(
      encoder.encode(
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      ),
    );
  },

  close() {
    controller.close();
  },
};
}

describe('Home live crawl streaming', () => {
  const frameCallbacks = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  let crawlChannels: SseChannel[];

  beforeEach(() => {
    frameCallbacks.clear();
    nextFrameId = 0;
    crawlChannels = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/wikipedia/search')) {
        return Promise.resolve(Response.json([]));
      }
      if (url.includes('/api/crawl')) {
        const channel = createSseChannel();
        crawlChannels.push(channel);
        return Promise.resolve(channel.response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }));
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frameCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frameCallbacks.delete(id);
    });
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

function runPendingFrames() {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();

  act(() => {
    for (const callback of callbacks) callback(0);
  });
}

  it('never applies a stale crawl stream update queued around a newer crawl', async () => {
    window.history.replaceState({}, '', '/?seed=Alpha&depth=1&nodes=10');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Home />
      </QueryClientProvider>
    );

    // 1. Crawl A starts (from the URL seed) and queues a live update.
    await waitFor(() => expect(crawlChannels).toHaveLength(1));
    const crawlA = crawlChannels[0];
    crawlA.emit('nodes', { nodes: [makeNode('Stale Page From A')] });
    await waitFor(() => expect(frameCallbacks.size).toBe(1));

    // 2. Crawl B starts before crawl A's animation frame runs.
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => expect(crawlChannels).toHaveLength(2));
    expect(frameCallbacks.size).toBe(0);

    // Crawl B queues its own live update, scheduling a new frame.
    const crawlB = crawlChannels[1];
    crawlB.emit('nodes', { nodes: [makeNode('Fresh Page From B')] });
    await waitFor(() => expect(frameCallbacks.size).toBe(1));

    // The stale crawl A stream then delivers a late update before the frame runs.
    // (The progress event only proves crawl A's reader loop processed the nodes event first.)
    crawlA.emit('nodes', { nodes: [makeNode('Late Stale Page From A')] });
    crawlA.emit('progress', { progress: { done: 1, target: 2 } });
    await waitFor(() => expect(screen.getByText(/% mapped/)).toHaveTextContent('50% mapped'));

    act(() => runPendingFrames());

    // 3. Crawl A's updates never reach crawl B...
    expect(screen.queryByText('Stale Page From A')).not.toBeInTheDocument();
    expect(screen.queryByText('Late Stale Page From A')).not.toBeInTheDocument();
    // 4. ...and crawl B's update still applies normally.
    expect(screen.getByText('Crawl in progress: 1 pages found')).toBeInTheDocument();
    expect(screen.getByText('Fresh Page From B')).toBeInTheDocument();
  });
  it('keeps a partially expanded node retryable and marks it expanded only after completion', async () => {
  window.history.replaceState(
    {},
    '',
    '/?seed=Alpha&depth=1&nodes=10',
  );

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(crawlChannels).toHaveLength(1);
  });

  const initialCrawl = crawlChannels[0];

  initialCrawl.emit('nodes', {
    nodes: [
      makeNode('Page 0'),
      makeNode('Page 1'),
    ],
  });

  initialCrawl.emit('edges', {
    edges: [
      { source: 'Page 0', target: 'Page 1' },
    ],
  });

  act(() => {
  runPendingFrames();
});

  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: /Page 0/ }),
    ).toBeInTheDocument();
  });

  // Select Page 0 from the sidebar.
  fireEvent.click(
    screen.getByRole('button', { name: /Page 0/ }),
  );

  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Expand' }),
    ).toBeInTheDocument();
  });

  // Start expansion.
  fireEvent.click(
    screen.getByRole('button', { name: 'Expand' }),
  );

  await waitFor(() => {
    expect(crawlChannels).toHaveLength(2);
  });

  const partialExpansion = crawlChannels[1];

  partialExpansion.emit('done', {
    result: {
      id: 'partial-expansion',
      seedId: 'Page 0',
      nodes: [makeNode('Page 2')],
      edges: [
        { source: 'Page 0', target: 'Page 2' },
      ],
      communities: [],
      crawledAt: new Date().toISOString(),
      positions: {},
      partial: true,
      failedTitles: ['Page 3'],
    },
  });

  partialExpansion.close();

  // The node must remain retryable.
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Expand' }),
    ).toBeInTheDocument();
  });

  expect(
    screen.queryByRole('button', { name: 'Expanded' }),
  ).not.toBeInTheDocument();

  // Retry the expansion.
  fireEvent.click(
    screen.getByRole('button', { name: 'Expand' }),
  );

  await waitFor(() => {
    expect(crawlChannels).toHaveLength(3);
  });

  const completedExpansion = crawlChannels[2];

  completedExpansion.emit('done', {
    result: {
      id: 'completed-expansion',
      seedId: 'Page 0',
      nodes: [makeNode('Page 3')],
      edges: [
        { source: 'Page 0', target: 'Page 3' },
      ],
      communities: [],
      crawledAt: new Date().toISOString(),
      positions: {},
      partial: false,
      failedTitles: [],
    },
  });

  completedExpansion.close();

  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Expanded' }),
    ).toBeInTheDocument();
  });
});

it('resets expanded-node state when starting Go deeper', async () => {
  window.history.replaceState(
    {},
    '',
    '/?seed=Alpha&depth=1&nodes=10',
  );

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(crawlChannels).toHaveLength(1);
  });

  const initialCrawl = crawlChannels[0];

  const initialNodes = [
    makeNode('Page 0'),
    makeNode('Page 1'),
  ];

  initialCrawl.emit('done', {
    result: {
      id: 'initial-result',
      seedId: 'Page 0',
      nodes: initialNodes,
      edges: [
        { source: 'Page 0', target: 'Page 1' },
      ],
      communities: [],
      crawledAt: new Date().toISOString(),
      positions: {},
      partial: false,
      failedTitles: [],
    },
  });

  initialCrawl.close();

  await waitFor(() => {
    expect(
      screen.getByText('Crawl complete: 2 pages found'),
    ).toBeInTheDocument();
  });

  // Select Page 0.
  fireEvent.click(
    screen.getByRole('button', { name: /Page 0/ }),
  );

  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Expand' }),
    ).toBeInTheDocument();
  });

  // Expand it successfully.
  fireEvent.click(
    screen.getByRole('button', { name: 'Expand' }),
  );

  await waitFor(() => {
    expect(crawlChannels).toHaveLength(2);
  });

  const expansion = crawlChannels[1];

  expansion.emit('done', {
    result: {
      id: 'expanded-result',
      seedId: 'Page 0',
      nodes: [makeNode('Page 2')],
      edges: [
        { source: 'Page 0', target: 'Page 2' },
      ],
      communities: [],
      crawledAt: new Date().toISOString(),
      positions: {},
      partial: false,
      failedTitles: [],
    },
  });

  expansion.close();

  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Expanded' }),
    ).toBeInTheDocument();
  });

  // Open the crawl controls.
  fireEvent.click(
    screen.getByRole('button', { name: /Options/i }),
  );

  const goDeeperButton = screen.getByRole(
    'button',
    { name: /Go deeper/i },
  );

  expect(goDeeperButton).toBeInTheDocument();
  expect(goDeeperButton).toBeEnabled();

  // Start the new crawl.
  fireEvent.click(goDeeperButton);

  await waitFor(() => {
    expect(crawlChannels).toHaveLength(3);
  });

  // Expansion state must have been reset immediately.
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Expand' }),
    ).toBeInTheDocument();
  });

  expect(
    screen.queryByRole('button', { name: 'Expanded' }),
  ).not.toBeInTheDocument();
});

});
