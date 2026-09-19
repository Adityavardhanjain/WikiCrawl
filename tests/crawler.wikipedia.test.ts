import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockMediaWiki } from './helpers/mockMediaWiki';

vi.mock('../lib/db', () => ({
  getCachedPageLinks: vi.fn(() => null),
  setCachedPageLinks: vi.fn(),
}));

import { crawlWikipedia } from '../lib/crawler';
import { getPageLinksBatch } from '../lib/wikipedia';

describe('offline crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('crawls a small graph with bounded nodes, unique edges, and depth metadata', async () => {
    const mock = installMockMediaWiki();
    const progress: Array<{ visited: number; total: number }> = [];

    try {
      const result = await crawlWikipedia({
        seedTitle: 'Page 0',
        depth: 2,
        maxNodes: 20,
        onProgress: (visited, total) => progress.push({ visited, total }),
      });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.length).toBeLessThanOrEqual(28);
      expect(result.edges.length).toBeGreaterThan(0);
      expect(new Set(result.nodes.map((node) => node.id)).size).toBe(result.nodes.length);
      expect(new Set(result.edges.map((edge) => `${edge.source}|${edge.target}`)).size)
        .toBe(result.edges.length);
      expect(result.nodes.every((node) => node.depth >= 0 && node.depth <= 2)).toBe(true);
      expect(result.nodes.find((node) => node.id === 'Page 0')?.depth).toBe(0);
      expect(progress.length).toBe(result.nodes.length);
      expect(progress.map(({ visited }) => visited)).toEqual(
        Array.from({ length: progress.length }, (_, index) => index + 1),
      );
      expect(progress.every(({ total }) => total >= 1)).toBe(true);
      expect(mock.stats.requests).toBeGreaterThan(0);
    } finally {
      mock.restore();
    }
  });

  it('handles a 500-link continuation and returns every link row', async () => {
    const mock = installMockMediaWiki();

    try {
      const firstPage = await getPageLinksBatch(['Page 0']);
      expect(firstPage.pages[0].links).toHaveLength(500);
      expect(firstPage.continueToken).toBe('500');

      const secondPage = await getPageLinksBatch(['Page 0'], firstPage.continueToken);
      const links = [...firstPage.pages[0].links, ...secondPage.pages[0].links];
      expect(links).toHaveLength(650);
      expect(new Set(links).size).toBe(650);
      expect(secondPage.continueToken).toBeUndefined();
      expect(mock.stats.requests).toBe(2);
      expect(mock.stats.linkRowsDownloaded).toBe(650);
    } finally {
      mock.restore();
    }
  });

  it('supports deterministic topical clusters without environment variables', async () => {
    const mock = installMockMediaWiki({ mode: 'topical' });

    try {
      const result = await crawlWikipedia({ seedTitle: 'Page 0', depth: 2, maxNodes: 12 });
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.length).toBeLessThanOrEqual(20);
      expect(result.nodes.some((node) => node.depth === 1)).toBe(true);
    } finally {
      mock.restore();
    }
  });
});