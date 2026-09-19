export type MockMediaWikiMode = 'default' | 'topical';

export interface MockMediaWikiStats {
  requests: number;
  linkRowsDownloaded: number;
}

export interface MockMediaWikiOptions {
  mode?: MockMediaWikiMode;
}

export interface MockMediaWikiHandle {
  stats: MockMediaWikiStats;
  restore: () => void;
}

const LINKS_PER_REQUEST = 500;

function normalizeTitle(title: string): string {
  return title.replace(/_/g, ' ').trim();
}

function pageNumber(title: string): number | null {
  const match = normalizeTitle(title).match(/^Page (\d+)$/);
  return match ? Number(match[1]) : null;
}

function isKnownPage(title: string): boolean {
  return pageNumber(title) !== null;
}

function defaultLinks(title: string): string[] {
  const number = pageNumber(title) ?? 0;
  const count = number === 0 ? 650 : 120;
  return Array.from({ length: count }, (_, index) => `Page ${number + index + 1}`)
    .sort((left, right) => left.localeCompare(right));
}

function topicalLinks(title: string): string[] {
  const number = pageNumber(title) ?? 0;
  const cluster = number % 4;
  return Array.from({ length: 120 }, (_, index) => {
    const offset = index % 5 === 0 ? index + 1 : cluster * 30 + index;
    return `Page ${offset}`;
  }).filter((link, index, links) => links.indexOf(link) === index)
    .sort((left, right) => left.localeCompare(right));
}

function responseFor(
  titles: string[],
  offset: number,
  mode: MockMediaWikiMode,
  stats: MockMediaWikiStats,
): Response {
  const pages = titles
    .map((title) => {
      const normalizedTitle = normalizeTitle(title);
      if (!isKnownPage(normalizedTitle)) {
        return { title: normalizedTitle, missing: true };
      }
      const links = mode === 'topical' ? topicalLinks(normalizedTitle) : defaultLinks(normalizedTitle);
      const pageLinks = links.slice(offset, offset + LINKS_PER_REQUEST);
      stats.linkRowsDownloaded += pageLinks.length;
      return {
        pageid: pageNumber(normalizedTitle)!,
        title: normalizedTitle,
        links: pageLinks.map((link) => ({ title: link })),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  const hasMore = titles.some((title) => {
    if (!isKnownPage(title)) return false;
    const links = mode === 'topical' ? topicalLinks(title) : defaultLinks(title);
    return offset + LINKS_PER_REQUEST < links.length;
  });

  return Response.json({
    query: { pages },
    ...(hasMore ? { continue: { plcontinue: String(offset + LINKS_PER_REQUEST) } } : {}),
  });
}

export function installMockMediaWiki(options: MockMediaWikiOptions = {}): MockMediaWikiHandle {
  const mode = options.mode ?? 'default';
  const stats: MockMediaWikiStats = { requests: 0, linkRowsDownloaded: 0 };
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input.toString());
    const action = url.searchParams.get('action');

    stats.requests += 1;

    if (action === 'opensearch') {
      const search = url.searchParams.get('search') || 'Page 0';
      return Response.json([search, ['Page 0', 'Page 1'], ['Synthetic page'], ['https://example.test/Page_0']]);
    }

    if (action !== 'query' || url.searchParams.get('prop') !== 'links') {
      return Response.json({ query: { pages: {} } });
    }

    const titles = (url.searchParams.get('titles') || '').split('|').filter(Boolean);
    const offset = Number(url.searchParams.get('plcontinue') || '0');
    return responseFor(titles, Number.isFinite(offset) ? offset : 0, mode, stats);
  };

  return {
    stats,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}