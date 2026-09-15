import { NextRequest, NextResponse } from 'next/server';
import { searchWikipedia } from '@/lib/wikipedia';

const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; results: Awaited<ReturnType<typeof searchWikipedia>> }>();
const pendingSearches = new Map<string, Promise<Awaited<ReturnType<typeof searchWikipedia>>>>();

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
      return NextResponse.json(cached.results, {
        headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' },
      });
    }

    let search = pendingSearches.get(cacheKey);
    if (!search) {
      search = searchWikipedia(cacheKey);
      pendingSearches.set(cacheKey, search);
    }

    const results = await search;
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL, results });
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
