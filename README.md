# WikiCrawl

## Deployment

WikiCrawl uses `better-sqlite3` for its crawl cache when a writable filesystem is available. On Vercel, set `VERCEL` as provided by the platform and the SQLite file is placed in `/tmp`; that cache is ephemeral and scoped to an individual function instance. If SQLite cannot open, WikiCrawl falls back to bounded in-process memory caches, so caching remains best-effort rather than a deployment requirement.

For local development or a long-running Node.js server, set `WIKICRAWL_DB_PATH` when you want the database in a specific writable location. For a shared production cache across instances, the next upgrade path is a shared store such as Upstash Redis or Turso; neither is required by the current deployment.