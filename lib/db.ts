import Database from 'better-sqlite3';
import path from 'path';
import type { CrawlResult } from '@/types/graph';

const DB_PATH = path.join(process.cwd(), 'wiki-crawl.db');
const PAGE_LINKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_VIEWS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedPageLinks {
  title: string;
  resolvedTitle: string;
  links: string[];
  complete: boolean;
}

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

      CREATE TABLE IF NOT EXISTS page_links_cache (
        title TEXT PRIMARY KEY,
        resolved_title TEXT NOT NULL,
        links TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS page_views_cache (
        title TEXT PRIMARY KEY,
        views INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
  return db;
}

function normalizePageTitle(title: string): string {
  return title.replace(/_/g, ' ').trim().toLowerCase();
}

export function getCachedPageLinks(title: string): CachedPageLinks | null {
  try {
    const database = getDb();
    const row = database.prepare(`
      SELECT title, resolved_title, links, created_at
      FROM page_links_cache
      WHERE title = ?
    `).get(normalizePageTitle(title)) as {
      title: string;
      resolved_title: string;
      links: string;
      created_at: string;
    } | undefined;

    if (!row || Date.now() - Date.parse(row.created_at) > PAGE_LINKS_CACHE_TTL_MS) {
      return null;
    }

    const parsedLinks = JSON.parse(row.links) as string[] | { links: string[]; complete?: boolean };
    return {
      title: row.title,
      resolvedTitle: row.resolved_title,
      links: Array.isArray(parsedLinks) ? parsedLinks : parsedLinks.links,
      complete: Array.isArray(parsedLinks) ? true : parsedLinks.complete !== false,
    };
  } catch (error) {
    console.error('Error reading page links cache:', error);
    return null;
  }
}

export function setCachedPageLinks(page: CachedPageLinks): void {
  try {
    const database = getDb();
    database.prepare(`
      INSERT OR REPLACE INTO page_links_cache (title, resolved_title, links, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      normalizePageTitle(page.title),
      page.resolvedTitle,
      JSON.stringify(page.links),
      new Date().toISOString()
    );
  } catch (error) {
    console.error('Error writing page links cache:', error);
  }
}

export function getCachedPageViews(title: string): number | null {
  try {
    const database = getDb();
    const row = database.prepare(`
      SELECT views, created_at
      FROM page_views_cache
      WHERE title = ?
    `).get(normalizePageTitle(title)) as { views: number; created_at: string } | undefined;

    if (!row || Date.now() - Date.parse(row.created_at) > PAGE_VIEWS_CACHE_TTL_MS) return null;
    return Number.isFinite(row.views) ? row.views : 0;
  } catch (error) {
    console.error('Error reading page views cache:', error);
    return null;
  }
}

export function setCachedPageViews(title: string, views: number): void {
  try {
    const database = getDb();
    database.prepare(`
      INSERT OR REPLACE INTO page_views_cache (title, views, created_at)
      VALUES (?, ?, ?)
    `).run(normalizePageTitle(title), Math.max(0, Math.trunc(views)), new Date().toISOString());
  } catch (error) {
    console.error('Error writing page views cache:', error);
  }
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

