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
  // Simple hash function for the cache key
  const input = `${seedTitle.toLowerCase()}|${depth}|${maxNodes}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
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

export function getCachedBySeed(seedTitle: string, depth: number, maxNodes: number): CrawlResult | null {
  try {
    const database = getDb();
    const row = database.prepare(`
      SELECT result FROM crawl_cache 
      WHERE seed_title = ? AND depth = ? AND max_nodes = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(seedTitle, depth, maxNodes) as { result: string } | undefined;
    
    if (row) {
      return JSON.parse(row.result) as CrawlResult;
    }
    return null;
  } catch (error) {
    console.error('Error reading from cache:', error);
    return null;
  }
}

export function clearCache(): void {
  try {
    const database = getDb();
    database.exec('DELETE FROM crawl_cache');
  } catch (error) {
    console.error('Error clearing cache:', error);
  }
}
