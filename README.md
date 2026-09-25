types/     Shared graph types
tests/     API, crawler, and performance tests
docs/      Wikipedia API notes
scripts/   Wikipedia API probe
```
# WikiCrawl

WikiCrawl turns links around a Wikipedia article into an interactive graph. Search for a topic, watch the crawl arrive, and inspect the pages and connections in the resulting map.

[Open the live app](https://wiki-crawl.vercel.app) · [Report an issue](https://github.com/Adityavardhanjain/WikiCrawl/issues) · [Source](https://github.com/Adityavardhanjain/WikiCrawl)

![CI](https://img.shields.io/github/actions/workflow/status/Adityavardhanjain/WikiCrawl/ci.yml?branch=main&label=CI) ![License](https://img.shields.io/github/license/Adityavardhanjain/WikiCrawl)

## What it does

Start from a Wikipedia article and crawl its outgoing article links to a chosen depth. WikiCrawl builds a directed graph, streams useful results as they arrive, and makes that graph available for exploration.

- **Search and crawl:** choose an article, a depth from one to three hops, and a page limit from 50 to 500.
- **Read the map:** color nodes by community or crawl depth; zoom, fit, reset, and adjust edge display.
- **Inspect pages:** select a node to see its summary, graph metrics, community, and connected pages.
- **Explore deeper:** crawl outward from a selected node and merge newly found pages into the current graph.
- **Go deeper:** start a new crawl from the original seed with greater depth. The chosen page limit is used for that crawl.
- **Find a path:** calculate a shortest route between pages already in the map.

Graph metrics and community labels are computed over the crawled subgraph, not all of Wikipedia. Shortest-path search treats links as undirected, even though crawl edges retain their direction.

## Request and data flow

```mermaid
flowchart LR
	U[Browser] --> S[Wikipedia search route]
	U --> C[Crawl route]
	S --> W[MediaWiki API]
	C --> R[Bounded crawler]
	R --> W
	R --> A[Graphology analysis]
	A --> E[Server-sent events]
	E --> U
	U --> G[Sigma graph renderer]
	G --> F[ForceAtlas2 worker]
`

The crawler requests article links in batches and follows MediaWiki continuation tokens. It normalizes underscores and spaces, resolves redirects, avoids duplicate nodes, filters noisy titles, and bounds concurrency and upstream requests. Pageviews are used to prioritize candidates when available; a seed-based deterministic ordering is used when they are not.

During an initial crawl, nodes, edges, progress, and analysis are sent to the browser over a server-sent event stream. The client applies updates incrementally to a Graphology graph, while Sigma renders the map. The graph layout runs in a ForceAtlas2 worker so layout work does not block the main UI thread.

Node expansion is a separate operation from increasing root crawl depth. The expansion request sends known node IDs and edges as index pairs, allowing the server to recalculate metrics for the combined graph without the client resending a verbose edge object list. The returned delta is merged into the current graph.

## Bounds and failure behavior

| Resource | Current bound |
| --- | ---: |
| Crawl depth | 1–3 hops |
| Maximum pages requested | 50–500 |
| Crawler traversal request budget | At most 500 upstream requests |
| Crawler concurrency | At most 3 |
| Expansion payload | At most 500 known nodes and 50,000 edges |
| Crawl API throttle | 60 requests per client address in a rolling 10-minute window |

The crawler request budget applies after the crawl route's separate seed-page validation request. A crawl may return a partial graph if Wikipedia is unavailable, rate-limits requests, or the request budget is exhausted. The UI reports unavailable pages where known.

The crawl throttle is an in-process sliding-window limit. It uses `x-real-ip`, then the last address in `x-forwarded-for`; reverse proxies must overwrite or append these headers correctly. Each server process or serverless instance maintains its own counters, so this is a basic abuse-control measure, not a distributed quota. For multi-instance enforcement, use a shared rate-limit store at the edge or in a service such as Redis.

Unexpected rendering errors show a retry screen at the route level. Errors in the root layout have a separate global fallback. Expected crawl and network errors continue to use the app's normal inline error states.

## Caching and persistence

The server caches page links, pageview data, and completed crawl results. SQLite is used when `better-sqlite3` can load and the database path is writable. If SQLite is unavailable, bounded in-process memory caches are used so a cache failure does not prevent crawling. Memory entries are local to one process and are lost when it stops.

The default local database path is `./wiki-crawl.db`. On Vercel, the default is `/tmp/wiki-crawl.db`; that filesystem is ephemeral and is not shared between function instances. Treat all caches as performance optimizations, not durable state.

## Run locally

Requirements: Node.js 22, npm, and network access to Wikipedia/Wikimedia APIs.

```bash
git clone https://github.com/Adityavardhanjain/WikiCrawl.git
cd WikiCrawl
npm ci
npm run dev
```

Open <http://localhost:3000>.

To run the production build locally:

```bash
npm run build
npm start
```

## Configuration

All variables are optional:

| Variable | Purpose | Default |
| --- | --- | --- |
| `WIKI_CONTACT` | Contact information included in the Wikimedia API user agent | Not set |
| `CRAWL_CONCURRENCY` | Requested crawler concurrency; the server caps it at 3 | `3` |
| `WIKICRAWL_DB_PATH` | SQLite database location | `./wiki-crawl.db`; `/tmp/wiki-crawl.db` on Vercel |
| `NEXT_PUBLIC_SITE_URL` | Public origin used to construct absolute metadata and share-image URLs | `https://wiki-crawl.vercel.app` |

For local development, put overrides in `.env.local`:

```env
WIKI_CONTACT=you@example.com
WIKICRAWL_DB_PATH=./wiki-crawl.db
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The favicon, Open Graph image, and Twitter image are generated by Next.js from files in `app/`; no `public/` directory or checked-in image binaries are required.

## Tests and checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Additional commands:

```bash
npm run bench            # Crawl and performance benchmarks
npm run probe:wikipedia  # Inspect live Wikipedia API behavior
```

The test suite includes crawler, route, graph, component, and UI behavior tests. SQLite-specific tests require the `better-sqlite3` native binding to load; in environments where it cannot load, those tests may fail even though the application can use its memory-cache fallback.

GitHub Actions runs `npm ci`, typecheck, lint, tests, and a production build on pushes to `main` and pull requests. Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Project layout

```text
app/       Next.js UI, route error fallbacks, generated metadata images, and API routes
lib/       Wikipedia client, crawler, graph analysis, cache, and request utilities
types/     Shared graph types
tests/     API, crawler, and performance tests
docs/      Wikipedia API investigation notes
scripts/   Wikipedia API probe
```

## License

MIT. See [LICENSE](LICENSE).
