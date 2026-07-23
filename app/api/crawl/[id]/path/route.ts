import { NextRequest, NextResponse } from 'next/server';
import { buildGraph } from '@/lib/crawler';
import { getShortestPath } from '@/lib/graphAnalysis';
import { getCachedResult } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const searchParams = request.nextUrl.searchParams;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json(
      { error: 'from and to parameters are required' },
      { status: 400 }
    );
  }

  try {
    // In a real implementation, we'd look up the crawl result by ID
    // For now, we'll return an error since we don't have the full crawl result
    // The client should pass the full crawl result or we need a different approach
    
    return NextResponse.json(
      { error: 'Path lookup requires full crawl context' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Path error:', error);
    return NextResponse.json(
      { error: 'Failed to compute path' },
      { status: 500 }
    );
  }
}
