import Database from 'better-sqlite3';
import path from 'path';
import type { CrawlResult } from '@/types/graph';

const DB_PATH = path.join(process.cwd(), 'wiki-crawl.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    
    // Create tables if they don't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS crawl_cache (
        id TEXT PRIMARY KEY,
        seed_title TEXT NOT NULL,
        depth INTEGER NOT NULL,
        max_nodes INTEGER NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_crawl_cache_lookup 
      ON crawl_cache(seed_title, depth, max_nodes);
    `);
  }
  return db;
}

export function generateCacheKey(seedTitle: string, depth: number, maxNodes: number): string {
  const normalized = seedTitle.replace(/_/g, ' ').trim().toLowerCase();
  return `${normalized}|${depth}|${maxNodes}`;
}

export function getCachedResult(cacheKey: string): CrawlResult | null {
  try {
    const database = getDb();
    const row = database.prepare(
      'SELECT result FROM crawl_cache WHERE id = ?'
    ).get(cacheKey) as { result: string } | undefined;
    
    if (row) {
      return JSON.parse(row.result) as CrawlResult;
    }
    return null;
  } catch (error) {
    console.error('Error reading from cache:', error);
    return null;
  }
}

export function setCachedResult(
  cacheKey: string,
  seedTitle: string,
  depth: number,
  maxNodes: number,
  result: CrawlResult
): void {
  try {
    const database = getDb();
    database.prepare(`
      INSERT OR REPLACE INTO crawl_cache (id, seed_title, depth, max_nodes, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      cacheKey,
      seedTitle,
      depth,
      maxNodes,
      JSON.stringify(result),
      new Date().toISOString()
    );
  } catch (error) {
    console.error('Error writing to cache:', error);
  }
}

