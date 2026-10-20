# collector

One local page of every cron job and agent run across machines. Plain Python (standard library only) and one HTML file; no build step.

## Commands

```bash
python3 server.py              # http://localhost:4000
python3 collect.py | python3 -m json.tool   # one machine snapshot
```

## Dangers

- The repo is public. `config.json` holds real host names and job names: it is gitignored, keep it that way. Examples use `example.com`-style placeholders.
- `collect.py` runs on remote machines through `ssh host python3 -`: standard library only, read only.
