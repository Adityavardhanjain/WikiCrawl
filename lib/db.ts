import Database from 'better-sqlite3';
import path from 'path';
import type { CrawlResult } from '@/types/graph';

const DB_PATH = path.join(process.cwd(), 'wiki-crawl.db');
const RESOLVED_DB_PATH = process.env.WIKICRAWL_DB_PATH
  || (process.env.VERCEL ? '/tmp/wiki-crawl.db' : DB_PATH);
const PAGE_LINKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_VIEWS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DB_FAILURE_COOLDOWN_MS = 60 * 1000;
const MEMORY_PAGE_LINKS_LIMIT = 500;
const MEMORY_RESULTS_LIMIT = 20;

export interface CachedPageLinks {
  title: string;
  resolvedTitle: string;
  links: string[];
  complete: boolean;
}

let db: Database.Database | null = null;
let dbFailureUntil = 0;

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
}

class LruCache<T> {
  private readonly entries = new Map<string, MemoryEntry<T>>();

  constructor(private readonly limit: number) {}

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

const memoryPageLinks = new LruCache<CachedPageLinks>(MEMORY_PAGE_LINKS_LIMIT);
const memoryPageViews = new LruCache<number>(MEMORY_PAGE_LINKS_LIMIT);
const memoryResults = new LruCache<CrawlResult>(MEMORY_RESULTS_LIMIT);

function rememberDbFailure(error: unknown): void {
  const now = Date.now();
  if (dbFailureUntil > now) return;
  dbFailureUntil = now + DB_FAILURE_COOLDOWN_MS;
  db = null;
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`[WikiCrawl] SQLite cache unavailable for 60s; using in-memory fallback: ${reason}`);
}

function getDb(): Database.Database | null {
  if (db) return db;
  if (dbFailureUntil > Date.now()) return null;

  try {
    db = new Database(RESOLVED_DB_PATH);
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
    return db;
  } catch (error) {
    rememberDbFailure(error);
    return null;
  }
}

function normalizePageTitle(title: string): string {
  return title.replace(/_/g, ' ').trim().toLowerCase();
}

export function getCachedPageLinks(title: string): CachedPageLinks | null {
  const key = normalizePageTitle(title);
  const memoryValue = memoryPageLinks.get(key);
  if (memoryValue) return memoryValue;
  try {
    const database = getDb();
    if (!database) return null;
    const row = database.prepare(`
      SELECT title, resolved_title, links, created_at
      FROM page_links_cache
      WHERE title = ?
    `).get(key) as {
      title: string;
      resolved_title: string;
      links: string;
      created_at: string;
    } | undefined;

    if (!row || Date.now() - Date.parse(row.created_at) > PAGE_LINKS_CACHE_TTL_MS) {
      return null;
    }

    const parsedLinks = JSON.parse(row.links) as string[] | { links: string[]; complete?: boolean };
    const value = {
      title: row.title,
      resolvedTitle: row.resolved_title,
      links: Array.isArray(parsedLinks) ? parsedLinks : parsedLinks.links,
      complete: Array.isArray(parsedLinks) ? true : parsedLinks.complete !== false,
    };
    return value;
  } catch (error) {
    rememberDbFailure(error);
    return null;
  }
}

export function setCachedPageLinks(page: CachedPageLinks): void {
  const key = normalizePageTitle(page.title);
  try {
    const database = getDb();
    if (!database) {
      memoryPageLinks.set(key, page, PAGE_LINKS_CACHE_TTL_MS);
      return;
    }
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
    rememberDbFailure(error);
    memoryPageLinks.set(key, page, PAGE_LINKS_CACHE_TTL_MS);
  }
}

export function getCachedPageViews(title: string): number | null {
  const key = normalizePageTitle(title);
  const memoryValue = memoryPageViews.get(key);
  if (memoryValue !== null) return memoryValue;
  try {
    const database = getDb();
    if (!database) return null;
    const row = database.prepare(`
      SELECT views, created_at
      FROM page_views_cache
      WHERE title = ?
    `).get(key) as { views: number; created_at: string } | undefined;

    if (!row || Date.now() - Date.parse(row.created_at) > PAGE_VIEWS_CACHE_TTL_MS) return null;
    return Number.isFinite(row.views) ? row.views : 0;
  } catch (error) {
    rememberDbFailure(error);
    return null;
  }
}

export function setCachedPageViews(title: string, views: number): void {
  const key = normalizePageTitle(title);
  try {
    const database = getDb();
    if (!database) {
      memoryPageViews.set(key, views, PAGE_VIEWS_CACHE_TTL_MS);
      return;
    }
    database.prepare(`
      INSERT OR REPLACE INTO page_views_cache (title, views, created_at)
      VALUES (?, ?, ?)
    `).run(normalizePageTitle(title), Math.max(0, Math.trunc(views)), new Date().toISOString());
  } catch (error) {
    rememberDbFailure(error);
    memoryPageViews.set(key, views, PAGE_VIEWS_CACHE_TTL_MS);
  }
}

export function generateCacheKey(seedTitle: string, depth: number, maxNodes: number): string {
  const normalized = seedTitle.replace(/_/g, ' ').trim().toLowerCase();
  return `${normalized}|${depth}|${maxNodes}`;
}

export function getCachedResult(cacheKey: string): CrawlResult | null {
  const memoryValue = memoryResults.get(cacheKey);
  if (memoryValue) return memoryValue;
  try {
    const database = getDb();
    if (!database) return null;
    const row = database.prepare(
      'SELECT result FROM crawl_cache WHERE id = ?'
    ).get(cacheKey) as { result: string } | undefined;
    
    if (row) {
      return JSON.parse(row.result) as CrawlResult;
    }
    return null;
  } catch (error) {
    rememberDbFailure(error);
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
    if (!database) {
      memoryResults.set(cacheKey, result, PAGE_LINKS_CACHE_TTL_MS);
      return;
    }
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
    rememberDbFailure(error);
    memoryResults.set(cacheKey, result, PAGE_LINKS_CACHE_TTL_MS);
  }
}

