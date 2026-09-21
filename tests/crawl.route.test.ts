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

import { POST, safeClose, safeSend } from '../app/api/crawl/route';
import { setCachedResult } from '../lib/db';

describe('crawl route', () => {
  it('safe send and close return false after a stream controller is closed', () => {
    new ReadableStream({
      start(controller) {
        controller.close();
        expect(safeSend(controller, 'progress', {})).toBe(false);
        expect(safeClose(controller)).toBe(false);
      },
    });
  });

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

  it('does not cache an aborted crawl or emit an unhandled rejection', async () => {
    const mock = installMockMediaWiki();
    const abortController = new AbortController();
    const originalFetch = globalThis.fetch;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    globalThis.fetch = (async (input, init) => {
      const url = new URL(input.toString());
      if (url.searchParams.get('action') === 'query' && url.searchParams.get('prop') === 'links') {
        abortController.abort();
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    vi.mocked(setCachedResult).mockClear();

    try {
      const request = new Request('http://localhost/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedTitle: 'Page 0', depth: 1, maxNodes: 50 }),
        signal: abortController.signal,
      });
      const response = await POST(request as never);
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(vi.mocked(setCachedResult)).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      globalThis.fetch = originalFetch;
      mock.restore();
    }
  });
});