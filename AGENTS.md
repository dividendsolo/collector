# collector

One local page of every cron job and agent run across machines. Next.js (App Router) + TypeScript strict on Bun,
Tailwind v4 (no preflight: `app/globals.css` holds the page's own rules and tokens) with shadcn/ui tokens, Biome,
Vitest. No database, no auth, no deploy: local only. `collect.py` stays standard-library Python, sent over ssh.

## Layout

- `lib/server/`: every reader (machines, board, AI, vendors, domains, projects, revenue, DataFast) and its cache.
  Server state lives on `globalThis` (`store.ts`), so every route shares one cache and one board poller.
- `app/api/*/route.ts`: one JSON route per reader; `app/api/events` is the board's server-sent events.
- `components/`: the page (one client app with a hash router, as before).
- `instrumentation.ts`: starts the board poll and warms the readers at boot.

## Commands

```bash
bun dev                 # http://localhost:4000 with hot reload (COLLECTOR_PORT for another port)
bun run build           # production build
bun start               # serve the build on 127.0.0.1:${COLLECTOR_PORT:-4000}
bun run typecheck       # tsc --noEmit
bun run lint            # biome check .
bun run test            # vitest run
python3 collect.py | python3 -m json.tool   # one machine snapshot
```

## Dangers

- The repo is public. `config.json` (real host names, job names, board ids) and `.env` (keys) are gitignored: keep it
  that way. Examples use `example.com`-style placeholders. Never log or print a key or the keychain token.
- `collect.py` runs on remote machines through `ssh host python3 -`: standard library only, read only.
- The board poll costs 1 GraphQL point per read (about 360 an hour while a page is open). Keep it at 1: the page
  sizes in `lib/server/board.ts` keep the query under 100 connection requests.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
