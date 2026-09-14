const WIKIPEDIA_API_BASE = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'WikiCrawl/1.0 (https://github.com; contact@example.com)';
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

interface WikipediaExtract {
  extract?: string;
}

interface WikipediaPage {
  pageid: number;
  title: string;
  links?: WikipediaLink[];
  extract?: string;
  redirect?: { title: string };
}

interface WikipediaResponse {
  query?: {
    pages?: Record<string, WikipediaPage>;
    redirects?: { title: string; to: string }[];
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
  if (!query || query.trim().length < 2) {
    return [];
  }

  const url = new URL(WIKIPEDIA_API_BASE);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('action', 'opensearch');
  url.searchParams.set('search', query);
  url.searchParams.set('limit', '10');
  url.searchParams.set('namespace', '0');

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia API error: ${response.status}`);
  }

  const data = await response.json() as [string, string[], string[], string[]];

  // opensearch returns [query, titles, descriptions, urls]
  const titles = data[1];
  return titles.map((title) => ({ title }));
}

export async function getPageExtract(title: string): Promise<string | null> {
  const data = await fetchWikipedia({
    action: 'query',
    titles: title,
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
  });

  const pages = data.query?.pages;
  if (!pages) return null;
  
  const pageId = Object.keys(pages)[0];
  if (pageId === '-1') return null; // Page doesn't exist
  
  return pages[pageId].extract || null;
}

export interface PageLinksResult {
  title: string;
  resolvedTitle: string;
  links: string[];
  continueToken?: string;
}

export async function getPageLinks(title: string, continueToken?: string): Promise<PageLinksResult> {
  const params: Record<string, string> = {
    action: 'query',
    titles: title,
    prop: 'links',
    plnamespace: '0', // Only article pages
    pllimit: 'max', // Maximum 500 links per request
    redirects: '1', // Resolve redirects
  };

  if (continueToken) {
    params.plcontinue = continueToken;
  }

  const data = await fetchWikipedia(params);
  
  const pages = data.query?.pages;
  const redirects = data.query?.redirects || [];
  
  if (!pages) {
    return { title, resolvedTitle: title, links: [] };
  }

  const pageId = Object.keys(pages)[0];
  
  // Check if page doesn't exist
  if (pageId === '-1') {
    return { title, resolvedTitle: title, links: [] };
  }

  const page = pages[pageId];
  const links = page.links?.map((l) => l.title) || [];
  
  // Get the resolved title (accounting for redirects)
  let resolvedTitle = page.title;
  const redirectMap = new Map(redirects.map(r => [r.title, r.to]));
  if (redirectMap.has(title)) {
    resolvedTitle = redirectMap.get(title)!;
  }

  return {
    title,
    resolvedTitle,
    links,
    continueToken: data['continue']?.plcontinue,
  };
}

export function titleToUrl(title: string): string {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  return `https://en.wikipedia.org/wiki/${encoded}`;
}
