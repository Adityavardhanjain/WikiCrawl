import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockMediaWiki } from './helpers/mockMediaWiki';

vi.mock('../lib/db', () => ({
  getCachedPageLinks: vi.fn(() => null),
  setCachedPageLinks: vi.fn(),
}));

import { crawlWikipedia } from '../lib/crawler';
import { getPageLinksBatch } from '../lib/wikipedia';
import { setCachedPageLinks } from '../lib/db';

describe('offline crawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('crawls a small graph with bounded nodes, unique edges, and depth metadata', async () => {
    const mock = installMockMediaWiki();
    const progress: Array<{ done: number; target: number }> = [];

    try {
      const result = await crawlWikipedia({
        seedTitle: 'Page 0',
        depth: 2,
        maxNodes: 20,
        onProgress: (update) => progress.push(update),
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
      expect(progress.map(({ done }) => done)).toEqual(
        Array.from({ length: progress.length }, (_, index) => index + 1),
      );
      expect(progress.every(({ target }) => target >= 1)).toBe(true);
      expect(mock.stats.requests).toBeGreaterThan(0);
    } finally {
      mock.restore();
    }
  });

  it('reports monotonic varied progress through a large crawl', async () => {
    const mock = installMockMediaWiki();
    const progress: Array<{ done: number; target: number }> = [];

    try {
      await crawlWikipedia({
        seedTitle: 'Page 0',
        depth: 3,
        maxNodes: 500,
        onProgress: (update) => progress.push(update),
      });

      const ratios = progress.map(({ done, target }) => done / target);
      expect(ratios).toEqual([...ratios].sort((left, right) => left - right));
      expect(new Set(ratios).size).toBeGreaterThan(5);
      expect(ratios.at(-1)).toBe(1);
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

  it('does not cache missing pages', async () => {
    const mock = installMockMediaWiki();
    vi.mocked(setCachedPageLinks).mockClear();

    try {
      const result = await getPageLinksBatch(['Typoed article']);
      expect(result.pages[0]?.missing).toBe(true);
      expect(setCachedPageLinks).not.toHaveBeenCalled();
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