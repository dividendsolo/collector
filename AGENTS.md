# collector

Feature facts (keys, pages, how features work, verify steps) live in CONTEXT.md; keep them current there. This file holds only stack, commands and dangers.

One local page of every cron job and agent run across machines. Next.js (App Router) + TypeScript strict on Bun,
Tailwind v4 (no preflight: `app/globals.css` holds the page's own rules and tokens) with shadcn/ui tokens, Biome,
Vitest. No database, no auth, no deploy: local only. `collect.py` stays standard-library Python, sent over ssh.

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

- No comments in any tracked file: the global rule "No comments in code". `bin/no-comments` checks it, in `bun run lint` and in `ci.yml` (CONTEXT.md, No comments in code).

- The repo is public. `config.json` (real host names, job names, board ids) and `.env` (keys) are gitignored: keep it
  that way. Examples use `example.com`-style placeholders. Never log or print a key or the keychain token.
- `collect.py` runs on remote machines through `ssh host python3 -`: standard library only, read only.
- The board poll costs 1 GraphQL point per read (about 360 an hour while a page is open). Keep it at 1: the page
  sizes in `lib/server/board.ts` keep the query under 100 connection requests.
- A write endpoint (`POST /api/projects`) writes the real `config.json`. Probe or test it only against a temp copy:
  `COLLECTOR_CONFIG=/tmp/collector-test.json`. A curl test on 2026-10-21 replaced the real projects with `["x/y"]`.

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices. `next.config.ts` sets `agentRules: false`, so `next dev` does not write its own block into this file.
