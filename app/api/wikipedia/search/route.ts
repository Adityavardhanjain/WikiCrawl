import { NextRequest, NextResponse } from 'next/server';
import { searchWikipedia } from '@/lib/wikipedia';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query || query.trim().length < 2) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchWikipedia(query.trim());
    return NextResponse.json(results);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Failed to search Wikipedia' },
      { status: 500 }
    );
  }
}
