import { getCachedPageLinks, setCachedPageLinks } from './db';

const WIKIPEDIA_API_BASE = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'WikiCrawl/1.0 (https://github.com/WikiCrawl)';
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(response: Response, attempt: number): number {
  const retryAfterHeader = response.headers.get('retry-after');
  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);
    if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }
  }

  return Math.min(2000 * 2 ** attempt, 10000);
}

interface WikipediaLink {
  title: string;
}

interface WikipediaSearchResult {
  title: string;
}

interface WikipediaPage {
  pageid?: number;
  title: string;
  missing?: boolean;
  links?: WikipediaLink[];
  extract?: string;
}

interface WikipediaResponse {
  query?: {
    pages?: WikipediaPage[];
    redirects?: { from?: string; title?: string; to: string }[];
  };
  'continue'?: {
    plcontinue?: string;
  };
}

async function fetchWikipedia(params: Record<string, string>): Promise<WikipediaResponse> {
  const url = new URL(WIKIPEDIA_API_BASE);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (response.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new Error('Wikipedia is rate limiting requests. Please wait a moment and try again.');
      }

      await sleep(getRetryDelay(response, attempt));
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }

    return response.json();
  }

  throw new Error('Wikipedia request failed after retries');
}

export async function searchWikipedia(query: string): Promise<WikipediaSearchResult[]> {
  if (!query || query.trim().length < 1) {
    return [];
  }

  const data = await fetchWikipedia({
    action: 'opensearch',
    search: query,
    limit: '10',
    namespace: '0',
  }) as unknown as [string, string[], string[], string[]];

  // opensearch returns [query, titles, descriptions, urls]
  const titles = data[1] ?? [];
  return titles.map((title) => ({ title }));
}

export async function getPageExtract(title: string): Promise<string | null> {
  const data = await fetchWikipedia({
    action: 'query',
    formatversion: '2',
    titles: title,
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
  });

  const page = data.query?.pages?.[0];
  if (!page || page.missing) return null;

  return page.extract || null;
}

export interface PageLinksResult {
  title: string;
  resolvedTitle: string;
  links: string[];
  missing?: boolean;
}

export interface PageLinksBatchResult {
  pages: PageLinksResult[];
  continueToken?: string;
}

const MAX_BATCH_TITLES = 50;

export async function getPageLinksBatch(
  titles: string[],
  continueToken?: string
): Promise<PageLinksBatchResult> {
  if (titles.length === 0) {
    return { pages: [] };
  }

  const requestedTitles = titles.slice(0, MAX_BATCH_TITLES);
  const cachedPages = new Map<string, PageLinksResult>();
  const missingTitles = requestedTitles.filter((title) => {
    if (continueToken) return true;

    const cachedPage = getCachedPageLinks(title);
    if (!cachedPage) return true;

    cachedPages.set(title, { ...cachedPage, title });
    return false;
  });

  if (missingTitles.length === 0) {
    return { pages: requestedTitles.map((title) => cachedPages.get(title)!) };
  }

  const params: Record<string, string> = {
    action: 'query',
    formatversion: '2',
    titles: missingTitles.join('|'),
    prop: 'links',
    plnamespace: '0', // Only article pages
    pllimit: 'max', // Maximum 500 links per request
    redirects: '1', // Resolve redirects
  };

  if (continueToken) {
    params.plcontinue = continueToken;
  }

  const data = await fetchWikipedia(params);
  
  const pages = data.query?.pages || [];
  const redirects = data.query?.redirects || [];
  const redirectMap = new Map(redirects.map((redirect) => [redirect.from || redirect.title || '', redirect.to]));

  const fetchedPages = missingTitles.map((title) => {
    const resolvedTitle = redirectMap.get(title) || title;
    const normalizedResolvedTitle = resolvedTitle.toLowerCase();
    const normalizedTitle = title.toLowerCase();
    const page = pages.find((candidate) => (
      (candidate.title.toLowerCase() === normalizedResolvedTitle || candidate.title.toLowerCase() === normalizedTitle)
    ));

    if (!page || page.missing) {
      return { title, resolvedTitle: title, links: [], missing: true };
    }

    return {
      title,
      resolvedTitle: page.title || resolvedTitle,
      links: page.links?.map((link) => link.title) || [],
    };
  });

  if (!data['continue']?.plcontinue && !continueToken) {
    for (const page of fetchedPages) {
      if (!page.missing) setCachedPageLinks(page);
    }
  }

  return {
    pages: requestedTitles.map((title) => cachedPages.get(title) || fetchedPages.find((page) => page.title === title)!).filter(Boolean),
    continueToken: data['continue']?.plcontinue,
  };
}

export async function getPageLinks(title: string, continueToken?: string): Promise<PageLinksResult> {
  const result = await getPageLinksBatch([title], continueToken);
  return result.pages[0] || { title, resolvedTitle: title, links: [] };
}

export function titleToUrl(title: string): string {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  return `https://en.wikipedia.org/wiki/${encoded}`;
}
