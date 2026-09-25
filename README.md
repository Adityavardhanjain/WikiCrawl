# WikiCrawl

WikiCrawl turns the links around a Wikipedia article into an interactive graph. Search for a topic, follow the crawl as pages arrive, and inspect how the pages in that crawl connect.

[Open the live app](https://wiki-crawl.vercel.app) · [Report an issue](https://github.com/Adityavardhanjain/WikiCrawl/issues) · [Source](https://github.com/Adityavardhanjain/WikiCrawl)

![CI](https://img.shields.io/github/actions/workflow/status/Adityavardhanjain/WikiCrawl/ci.yml?branch=main&label=CI) ![License](https://img.shields.io/github/license/Adityavardhanjain/WikiCrawl)

## Use the app

1. Search for a Wikipedia article or choose one of the example topics.
2. Set crawl depth (1–3 hops) and maximum pages (50–500), then start the map.
3. Switch between community and depth coloring. Use the atlas to find highly ranked pages, bridges, or clusters.
4. Select a page to inspect its summary and connections. **Explore deeper** adds that page's neighborhood to the current graph.
5. Use **Go deeper** to rerun the crawl from the original article at a greater depth. Its target depth and page limit are shown in the crawl controls.
6. Find a shortest path between pages already in the graph from a page's detail panel.

PageRank, betweenness, communities, and paths describe only the crawled graph, not all of Wikipedia. Pathfinding treats links as undirected connections.

## How it works

The Next.js server queries Wikipedia's MediaWiki API, follows link continuation tokens, resolves redirects, and traverses pages in bounded batches. Crawl nodes, edges, progress, and analysis are streamed to the browser while a crawl is running. The client merges updates into a Graphology graph and renders it with Sigma.js; ForceAtlas2 arranges the graph in a worker.

An initial crawl starts from the searched article. Expanding a selected page sends the server the known node IDs and edge index pairs, crawls from that page, then merges the result into the existing graph. **Go deeper** is different: it starts a new crawl from the original seed with a greater hop depth.

Pageviews can prioritize candidate pages within a crawl layer. If pageview data is unavailable, a deterministic ordering is used. Wikipedia failures or request limits can result in a partial graph; the app reports unavailable pages when this happens.

## Limits and caching

The interface and crawl API constrain requests to:

| Setting | Limit |
| --- | ---: |
| Crawl depth | 1–3 hops |
| Maximum pages | 50–500 |
| Crawler traversal request budget | At most 500 |
| Crawl concurrency | At most 3 |
| Expansion payload | At most 500 known nodes and 50,000 edges |

The server caches page links, pageviews, and completed crawl results. It uses SQLite when the native module and database path are available, and bounded in-process memory caches otherwise. Memory caches are local to one server process. On Vercel, `/tmp/wiki-crawl.db` is ephemeral and is not shared across function instances, so cached data is an optimization, not durable storage.

The traversal budget applies after the route's separate seed-page validation request.

## Run locally

Requirements: Node.js 22, npm, and network access to Wikipedia/Wikimedia APIs.

```bash
git clone https://github.com/Adityavardhanjain/WikiCrawl.git
cd WikiCrawl
npm ci
npm run dev
```

Open <http://localhost:3000>.

For a production build:

```bash
npm run build
npm start
```

## Configuration

All settings are optional:

| Variable | Purpose | Default |
| --- | --- | --- |
| `WIKI_CONTACT` | Contact information added to the Wikimedia API user agent | None |
| `CRAWL_CONCURRENCY` | Requested crawler concurrency; the server caps it at 3 | `3` |
| `WIKICRAWL_DB_PATH` | SQLite database location | `./wiki-crawl.db`; `/tmp/wiki-crawl.db` on Vercel |

For example, create `.env.local` for local development:

```env
WIKI_CONTACT=you@example.com
WIKICRAWL_DB_PATH=./wiki-crawl.db
```

## Development checks

```bash
npm test                 # Vitest test suite
npm run typecheck        # TypeScript check
npm run lint             # ESLint
npm run build            # Production build
npm run bench            # Crawl and performance benchmarks
npm run probe:wikipedia  # Probe Wikipedia API behavior
```

The CI workflow runs install, typecheck, lint, tests, and a production build on pushes to `main` and pull requests. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Project layout

```text
app/       Next.js page, UI components, and API routes
lib/       Crawler, Wikipedia client, graph analysis, caching, and graph utilities
types/     Shared graph types
tests/     API, crawler, and performance tests
docs/      Wikipedia API notes
scripts/   Wikipedia API probe
```

## License

MIT. See [LICENSE](LICENSE).
