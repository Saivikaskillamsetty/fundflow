# Deploying FundFlow

Live: **https://fundflow-beta.vercel.app**

FundFlow splits into two halves that cannot share a host:

| Half | What it is | Where it runs | Status |
| --- | --- | --- | --- |
| **Web** | Next.js dashboard, rankings, stock views, read APIs, upload intake | Vercel | deployed |
| **Ingest** | BullMQ worker, `parser/extract.py`, headless Chrome discovery, monthly cron | Container host | **not deployed yet** |

The ingest half needs a resident process, a Python subprocess, and a Chrome
binary. None of those exist in a Vercel Function, which is why it is deployed
separately rather than as a route.

Until the worker is running somewhere, `/api/upload` and `/api/sync` enqueue
jobs that nothing consumes. The dashboard still serves already-ingested data.

## Provisioned resources

| Service | Resource | Env var |
| --- | --- | --- |
| Postgres | Neon `neon-amber-fountain` | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` |
| Redis | Upstash `upstash-kv-emerald-brush` | `REDIS_URL` (`rediss://`, credentialed) |
| Blob storage | Vercel Blob `fundflow-uploads` | `BLOB_READ_WRITE_TOKEN` |

All three are connected to the `fundflow` Vercel project across Production,
Preview, and Development.

### Neon: use the direct endpoint, not the pooled one

Neon's pooled endpoint reports an **empty `search_path`** and rejects
`search_path` as a startup parameter:

```
ERROR: unsupported startup parameter in options: search_path
```

Drizzle emits unqualified table names, so every query fails there with
`relation "stocks" does not exist`. Setting `search_path` via `ALTER DATABASE`
or `ALTER ROLE` does **not** propagate through the pooler — both were tried.

[src/db/index.ts](src/db/index.ts) therefore prefers `DATABASE_URL_UNPOOLED`
when present and falls back to `DATABASE_URL`. Local Postgres and other hosts
only set the latter, so they are unaffected.

Tradeoff: no connection pooling. Fine at current scale. If traffic grows, the
better fix is schema-qualifying the Drizzle schema (`pgSchema("public")`) so
the pooled endpoint works again.

## Local env files

`vercel env pull` writes `.env.local`, which **Next.js loads at higher
precedence than `.env`** — that silently points local dev at the cloud
database. Keep cloud credentials in `.env.vercel` instead, which Next does not
auto-load:

```bash
vercel env pull .env.vercel
```

Use it explicitly when you mean to target cloud resources:

```bash
npx tsx --env-file=.env.vercel src/scripts/monthly-sync.ts
```

`.env` stays pointed at the local docker-compose stack and pins
`STORAGE_DRIVER=local`.

## File storage

Uploaded and downloaded workbooks go through [src/lib/storage.ts](src/lib/storage.ts):

- `STORAGE_DRIVER=local` (default without a blob token) writes to `./uploads`.
- `STORAGE_DRIVER=blob` uploads to Vercel Blob and returns an https URL; the
  parser materializes a temp copy before running Python, then deletes it.

A split deploy **must** use `blob` — the Vercel side writes the file and the
worker on another host reads it back. With a blob token present the driver
defaults to blob anyway, so Preview works without an explicit setting.

> Blobs use `access: "public"`. These are public AMC disclosures, so that is
> acceptable, but the URLs are unguessable rather than protected.

## Deploying the web half

```bash
vercel deploy --prod
```

Note: with no Git repository connected, plain `vercel deploy` targets
**production**, not preview.

### Git integration (not connected)

`vercel git connect` fails with:

```
Failed to connect Saivikaskillamsetty/fundflow to project.
```

This is not a repository-visibility problem — it still failed after the repo
was made public. The Vercel GitHub App is not installed on the account. Install
it at https://github.com/settings/installations, then re-run `vercel git connect`.

Until then: no push-triggered deploys, and branch-scoped Preview environment
variables are rejected (`Project "fundflow" does not have a connected Git
repository`).

## Deploying the ingest half

```bash
docker build -f Dockerfile.worker -t fundflow-worker .
docker run --env-file .env.vercel fundflow-worker
```

The image carries Chromium (`CHROME_PATH=/usr/bin/chromium`) and a Python venv
(`PYTHON_BIN=/opt/parser-venv/bin/python`), so discovery and parsing both work
without host setup.

Schedule the monthly pipeline on that same host — it replaces the macOS
`com.fundflow.monthly-sync` LaunchAgent:

```bash
npm run sync:monthly
```

## Database setup

The schema is applied with `push` (there is no `drizzle/` migrations
directory):

```bash
DATABASE_URL=<neon-direct-url> npx drizzle-kit push
```

Data was migrated from local Postgres with a data-only dump, excluding
`uploads` — those rows reference local file paths that mean nothing in the
cloud:

```bash
docker exec fundflow_pg pg_dump -U fundflow -d fundflow \
  --data-only --no-owner --no-privileges --exclude-table=uploads > data.sql
```

## Verifying a deploy

1. `GET /api/dashboard?month=<latest>` returns funds/stocks counts.
2. `POST /api/sync` returns `202` with a `jobId`.
3. Worker logs show `[worker] sync <AMC>: N queued`.
4. New rows reach `status=done` on the upload page.

Steps 2–4 require the ingest half to be running.
