import { describe, expect, it, vi } from 'vitest';
import { installMockMediaWiki } from './helpers/mockMediaWiki';

vi.mock('../lib/db', () => ({
  getCachedPageLinks: vi.fn(() => null),
  setCachedPageLinks: vi.fn(),
  getCachedPageViews: vi.fn(() => null),
  setCachedPageViews: vi.fn(),
  getCachedResult: vi.fn(() => null),
  setCachedResult: vi.fn(),
  generateCacheKey: vi.fn(() => 'test-cache-key'),
}));

import { POST } from '../app/api/crawl/route';

async function postCrawl(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/crawl', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return POST(request as never);
}

describe('crawl route', () => {
  it('returns not_found with suggestions for a missing seed', async () => {
    const mock = installMockMediaWiki();

    try {
      const request = new Request('http://localhost/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedTitle: 'Typoed article', depth: 2, maxNodes: 100 }),
      });
      const response = await POST(request as never);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({
        error: 'not_found',
        title: 'Typoed article',
        suggestions: ['Page 0', 'Page 1'],
      });
    } finally {
      mock.restore();
    }
  });

  it('rejects an expansion with too many known nodes', async () => {
  const knownNodeIds = Array.from(
    { length: 501 },
    (_, index) => `Page ${index}`,
  );

  const response = await postCrawl({
    seedTitle: 'Page 0',
    depth: 1,
    maxNodes: 50,
    knownNodeIds,
    knownEdgeIndexPairs: [],
    baseDepth: 0,
  });

  expect(response.status).toBe(400);

  const body = await response.json();

  expect(body).toEqual({
    error: 'Invalid expansion node count',
  });
});

it('rejects an expansion with too many known edges', async () => {
  const knownEdgeIndexPairs: [number, number][] = Array.from(
    { length: 50_001 },
    () => [0, 0],
  );

  const response = await postCrawl({
    seedTitle: 'Page 0',
    depth: 1,
    maxNodes: 50,
    knownNodeIds: ['Page 0'],
    knownEdgeIndexPairs,
    baseDepth: 0,
  });

  expect(response.status).toBe(400);

  const body = await response.json();

  expect(body).toEqual({
    error: 'Invalid expansion edge count',
  });
});

it('rejects an expansion with an empty node id', async () => {
  const response = await postCrawl({
    seedTitle: 'Page 0',
    depth: 1,
    maxNodes: 50,
    knownNodeIds: [''],
    knownEdgeIndexPairs: [],
    baseDepth: 0,
  });

  expect(response.status).toBe(400);

  const body = await response.json();

  expect(body).toEqual({
    error: 'Invalid expansion node id',
  });
});

it('rejects duplicate expansion node ids', async () => {
  const response = await postCrawl({
    seedTitle: 'Page 0',
    depth: 1,
    maxNodes: 50,
    knownNodeIds: ['Page 0', 'Page 0'],
    knownEdgeIndexPairs: [],
    baseDepth: 0,
  });

  expect(response.status).toBe(400);

  const body = await response.json();

  expect(body).toEqual({
    error: 'Duplicate expansion node id',
  });
});

it('rejects an expansion edge that does not contain exactly two indexes', async () => {
  const response = await postCrawl({
    seedTitle: 'Page 0',
    depth: 1,
    maxNodes: 50,
    knownNodeIds: ['Page 0'],
    knownEdgeIndexPairs: [[0] as unknown as [number, number]],
    baseDepth: 0,
  });

  expect(response.status).toBe(400);

  const body = await response.json();

  expect(body).toEqual({
    error: 'Invalid expansion edge index',
  });
});

it('rejects an expansion edge with an out-of-range index', async () => {
  const response = await postCrawl({
    seedTitle: 'Page 0',
    depth: 1,
    maxNodes: 50,
    knownNodeIds: ['Page 0'],
    knownEdgeIndexPairs: [[0, 1]],
    baseDepth: 0,
  });

  expect(response.status).toBe(400);

  const body = await response.json();

  expect(body).toEqual({
    error: 'Invalid expansion edge index',
  });
});

it('still accepts a valid expansion request', async () => {
  const mock = installMockMediaWiki();

  try {
    const response = await postCrawl({
      seedTitle: 'Page 0',
      depth: 1,
      maxNodes: 50,
      knownNodeIds: ['Page 0'],
      knownEdgeIndexPairs: [],
      baseDepth: 0,
    });

    expect(response.status).toBe(200);

    const body = await response.text();

    expect(body).toContain('event: done');
    expect(body).toContain('"result"');
  } finally {
    mock.restore();
  }
});

});