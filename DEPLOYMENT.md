# Deploying FundFlow

FundFlow splits into two halves that cannot share a host:

| Half | What it is | Where it runs |
| --- | --- | --- |
| **Web** | Next.js dashboard, rankings, stock views, read APIs, upload intake | Vercel |
| **Ingest** | BullMQ worker, `parser/extract.py`, headless Chrome discovery, monthly cron | Container host (Fly.io / Railway / any VPS) |

The ingest half needs a resident process, a Python subprocess, and a Chrome
binary. None of those exist in a Vercel Function, which is why it is deployed
separately rather than as a route.

Both halves talk to the same Postgres and Redis.

## Managed services

| Service | Provider | Env var |
| --- | --- | --- |
| Postgres | Neon (Vercel Marketplace) | `DATABASE_URL` — include `?sslmode=require` |
| Redis | Upstash (Vercel Marketplace) | `REDIS_URL` — `rediss://default:<pw>@<host>:6379` |
| Blob storage | Vercel Blob | `BLOB_READ_WRITE_TOKEN` (auto-injected on Vercel) |

`REDIS_URL` is parsed in full — username, password, and TLS for `rediss://`.
Local dev keeps working against the plain `redis://localhost:6380` from
`docker-compose.yml`.

## File storage

Uploaded and downloaded workbooks go through `src/lib/storage.ts`:

- `STORAGE_DRIVER=local` (default without a blob token) writes to `./uploads`
  and hands the parser that path.
- `STORAGE_DRIVER=blob` uploads to Vercel Blob and returns an https URL; the
  parser materializes a temp copy before running Python, then deletes it.

A split deploy **must** use `blob` — the Vercel side writes the file and the
worker on another host reads it back.

> Blobs are stored with `access: "public"`. These are public AMC disclosures, so
> that is acceptable here, but the URLs are unguessable rather than protected.
> Switch to private blob access if the bucket ever holds anything else.

## Deploy the web half (Vercel)

```bash
vercel link
vercel env add DATABASE_URL production
vercel env add REDIS_URL production
vercel env add STORAGE_DRIVER production   # value: blob
vercel deploy --prod
```

`BLOB_READ_WRITE_TOKEN` appears automatically once a Blob store is attached to
the project. `next build` is verified passing on this branch.

## Deploy the ingest half (container)

```bash
docker build -f Dockerfile.worker -t fundflow-worker .
docker run --env-file .env.production fundflow-worker
```

The image carries Chromium (`CHROME_PATH=/usr/bin/chromium`) and a Python venv
(`PYTHON_BIN=/opt/parser-venv/bin/python`), so discovery and parsing both work
without host setup.

Schedule the monthly pipeline on this same host — it replaces the macOS
`com.fundflow.monthly-sync` LaunchAgent:

```bash
npm run sync:monthly
```

## How sync works after the split

`POST /api/sync` no longer runs discovery inline. It enqueues onto the
`fundflow-sync` queue and returns `202` immediately; the worker performs
discovery, downloads, and enqueues per-file parse jobs. The upload page polls
`/api/uploads`, so rows appear as the worker progresses.

## Migrations

Run once against the managed database before the first deploy:

```bash
DATABASE_URL=<neon-url> npm run db:migrate
```

## Verifying a deploy

1. `GET /api/dashboard?month=<latest>` returns funds/stocks counts.
2. `POST /api/sync` returns `202` with a `jobId`.
3. Worker logs show `[worker] sync <AMC>: N queued`.
4. New rows reach `status=done` on the upload page.
