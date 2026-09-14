# WikiCrawl

## Deployment

WikiCrawl uses `better-sqlite3` for its crawl cache. Run it on local development or a long-running Node.js server with a writable, persistent filesystem. Typical serverless deployments are not supported because their filesystems are ephemeral and requests may run in separate instances without shared SQLite state.