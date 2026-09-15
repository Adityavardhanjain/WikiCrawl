import { NextRequest, NextResponse } from 'next/server';
import { searchWikipedia } from '@/lib/wikipedia';

const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 500;
const MAX_PENDING_SEARCHES = 100;
const searchCache = new Map<string, { expiresAt: number; results: Awaited<ReturnType<typeof searchWikipedia>> }>();
const pendingSearches = new Map<string, Promise<Awaited<ReturnType<typeof searchWikipedia>>>>();

function setSearchCache(key: string, value: { expiresAt: number; results: Awaited<ReturnType<typeof searchWikipedia>> }): void {
  searchCache.delete(key);
  searchCache.set(key, value);

  while (searchCache.size > MAX_SEARCH_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query || query.trim().length < 1) {
    return NextResponse.json([]);
  }

  try {
    const cacheKey = query.trim().toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setSearchCache(cacheKey, cached);
      return NextResponse.json(cached.results, {
        headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' },
      });
    }
    searchCache.delete(cacheKey);

    let search = pendingSearches.get(cacheKey);
    if (!search) {
      search = searchWikipedia(cacheKey);
      if (pendingSearches.size < MAX_PENDING_SEARCHES) {
        pendingSearches.set(cacheKey, search);
      }
    }

    const results = await search;
    setSearchCache(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL, results });
    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Wikipedia search is temporarily unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  } finally {
    pendingSearches.delete(query.trim().toLowerCase());
  }
}
