# Deploying FundFlow

Live: **https://fundflow-intelligence.vercel.app**

`fundflow-beta.vercel.app` still resolves to the same deployment and is kept as
an alias so older links do not break. `fundflow.vercel.app` is unavailable —
vercel.app subdomains are globally unique and that one belongs to another
account.

Both are custom domains, which matters: deployment protection on this project is
`all_except_custom_domains`, so both are exempt while the raw deployment URL is
not. `selfOrigin()` depends on that (see below).

Everything runs on Vercel in a single project — the Next.js app, the Python
holdings parser, and the monthly ingestion cron.

This used to be split across two hosts, because the ingest half appeared to need
a resident process, a Python subprocess, and a Chrome binary. Each of those
turned out to be avoidable:

| Old constraint | What was actually true |
| --- | --- |
| Needs headless Chrome | AMC pages were doing header-based bot checks, not JS rendering. Plain `fetch` with browser headers works for 8 of 9 AMCs; Nippon (the one genuinely JS-rendered page) is sourced from AdvisorKhoj. |
| Needs a Python subprocess | Python runs as its own Vercel Function (`api/parse.py`) and is called over HTTP. |
| Needs a resident queue worker | A workbook parses in ~1s. There is nothing to defer, so the queue and Redis are gone. |

## Architecture

| Piece | Where | Notes |
| --- | --- | --- |
| Dashboard, rankings, read APIs | Next.js on Vercel | unchanged |
| `POST /api/upload` | Next.js Function | stores to Blob, parses and ingests inline |
| `api/parse.py` | **Python** Vercel Function | pdfplumber / pymupdf / pandas |
| `GET /api/cron/sync` | Next.js Function | cron entrypoint; fans out |
| `POST /api/sync/[amc]` | Next.js Function | one AMC end to end |

### Why the sync fans out

One invocation per AMC, in parallel. Wall time is the slowest AMC rather than
the sum, and a broken source cannot starve the others. Within an AMC, files run
`SYNC_FILE_CONCURRENCY` at a time (default 4) — HDFC publishes ~40 workbooks per
run and a sequential pass would approach the 300s ceiling.

Measured on a preview deployment: HDFC (the worst case, 44 discovered files)
completes in **~17s**. A 2.2 MB / 74-scheme ABSL workbook parses in **~7.5s**
including cold start and blob download.

## Provisioned resources

| Service | Resource | Env var |
| --- | --- | --- |
| Postgres | Neon `neon-amber-fountain` | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` |
| Blob storage | Vercel Blob `fundflow-uploads` | `BLOB_READ_WRITE_TOKEN` |

Upstash Redis is **no longer used** — it existed only to carry the BullMQ queue
between the two hosts. The resource can be deleted.

### Secrets

| Name | Purpose |
| --- | --- |
| `PARSER_SECRET` | Authenticates Next.js → `api/parse.py`. |
| `CRON_SECRET` | Guards `/api/cron/sync` and `/api/sync/[amc]`; Vercel sends it as `Authorization: Bearer` on cron runs. |

Both are set for Production, Preview and Development. Rotate with
`vercel env rm` + `vercel env add`.

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
when present and falls back to `DATABASE_URL`.

Tradeoff: no connection pooling. Fine at current scale. If traffic grows, the
better fix is schema-qualifying the Drizzle schema (`pgSchema("public")`).

## The Python function

`api/parse.py` wraps `parser/extract.py`. It accepts a **Blob URL**, not file
bytes, so the workbook is transferred once rather than twice.

Two guards, both deliberate:

- **Shared secret** (`x-parser-secret`). Parsing is expensive; an open endpoint
  is a denial-of-wallet.
- **Blob-host allowlist.** Without it the endpoint fetches any URL a caller
  names, from inside Vercel's network — an SSRF primitive. Only
  `*.blob.vercel-storage.com` is permitted.

### Bundle size

Python Functions bundle every project file reachable at build time, and the
limit is 500 MB. The first attempt failed at **549 MB** because `node_modules`
and `.next` were being swept in.

Two layers keep it small, and both matter:

- [`.vercelignore`](.vercelignore) — what is never uploaded. **This is also what
  keeps `.env` and `.env.vercel` out of the function bundle**; without it, live
  Neon and Blob credentials ship inside the deployment.
- `functions["api/parse.py"].excludeFiles` in [vercel.json](vercel.json) — a
  second pass scoped to the Python function.

`requirements.txt` (root) is deliberately narrower than
`parser/requirements.txt`: it omits `reportlab`, which only generates test
fixtures.

`vercel build` generates `pyproject.toml` and `uv.lock` from it. Both are
gitignored.

## Cron

```json
{ "crons": [{ "path": "/api/cron/sync", "schedule": "0 4 * * *" }] }
```

Hobby allows **one run per day** with ±59min precision, so the cron fires daily
and the route decides whether today is a sync day (`SYNC_DAY_OF_MONTH`,
default 12). Anything more frequent fails at deploy time on Hobby.

Trigger a run by hand:

```bash
curl "https://fundflow-intelligence.vercel.app/api/cron/sync?force=1" \
  -H "authorization: Bearer $CRON_SECRET"
```

## Deploying

Git is connected, so pushes to `main` deploy production and branches get
Previews. Manually:

```bash
vercel deploy            # preview
vercel deploy --prod     # production
```

### Testing a preview

Previews sit behind Vercel Authentication, so automated calls need a bypass:

```bash
curl "$PREVIEW_URL/api/cron/sync?force=1" \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  -H "authorization: Bearer $CRON_SECRET"
```

The app forwards this header on its own internal calls (see
`internalHeaders()`), otherwise a function calling its sibling gets a login
page instead of JSON.

> `vercel dev` does **not** serve `api/parse.py` — it proxies all of `/api/*` to
> the Next.js dev server. That is a dev-server quirk only; the built routing
> table resolves `/api/parse` to the Python function. Test the parser on a
> preview deployment, not locally.

## Hobby plan ceilings

| Limit | Value |
| --- | --- |
| Function duration | 300s (not raisable; Pro allows 800s) |
| Function memory | 2048 MB |
| Cron frequency | once per day |
| Python bundle | 500 MB |

## Known limitation: Motilal Oswal publishes dead links

AdvisorKhoj lists Motilal's two newest months pointing at URLs that 404 on
`motilaloswalmf.com`, while older months resolve normally. Nothing downstream
can fix that — the files are not served.

Discovery HEAD-probes candidates and skips those that are definitively gone
(`isLikelyLive` in [http.ts](src/lib/fetcher/http.ts)), walking back up to
`STALE_MONTH_ALLOWANCE` extra months. Without it the dead newest links consume
the whole month budget and the AMC yields nothing.

The probe is deliberately asymmetric: **only 404/410 disqualifies a link.** A
403, a timeout, or a host refusing HEAD all count as live, because dropping a
good link costs a month of holdings while keeping a bad one costs one failed
download the sync already tolerates.

Consequence: Motilal trails the others by design until it fixes its own links.

## Known limitation: Edelweiss rejects datacenter IPs

Like HDFC, `edelweissmf.com` serves files to residential connections and blocks
Vercel. Discovery succeeds (the links come from AdvisorKhoj) but every download
fails in production, while the same URLs return real workbooks from a laptop.
Retries do not help — the block is by origin, not load.

The failure is deceptive: the CDN answers with an "Access Denied" page **at
HTTP 200**, once as a 794KB homepage, so neither the status nor the payload
size gives it away. Stored as-is it surfaced much later as an opaque parser
error on a file that looked fine.

Two guards in `fetchFile`, worth keeping regardless of the block:

- Payload sniffing (`looksLikeHtml`) rejects markup where a document is
  expected, naming the real cause at the point of failure.
- Retry with backoff for genuinely transient refusals. A 404/410 is never
  retried — a missing file stays missing.

Unlike HDFC there is no unprotected CDN to fall back to and no mirror on
AdvisorKhoj (all 42 links point at `edelweissmf.com`), so Edelweiss cannot be
refreshed from production. Its existing history through 2026-06 is intact.
Running `npm run sync:monthly` from a residential connection is the only way to
extend it.

## Known limitation: HDFC

`hdfcfund.com`'s WAF rejects datacenter IPs — its listing page returns 200 from
a residential connection and **403 from Vercel**. This is not Vercel-specific;
any cloud host would hit it. It works today from a laptop only because that is
where the sync used to run.

The file CDN (`files.hdfcfund.com`) is *not* protected and the URLs are fully
deterministic, so `hdfcDiscover` tries the page first and falls back to
constructing URLs from a pinned scheme list (`HDFC_SCHEMES` in
[src/lib/fetcher/amcs.ts](src/lib/fetcher/amcs.ts)).

**That list will drift.** A newly launched HDFC scheme is only picked up when
discovery runs from a non-datacenter IP. Refresh it by running
`npm run sync:monthly` locally, or by re-reading the listing page and
re-applying the `keepTopFundFile("HDFC", …)` filter.

## Measured full run

`GET /api/cron/sync?force=1` on a preview deployment:

```
9 AMCs | 202 schemes | 12,314 holdings | 28.3s
```

Two AMCs fail, both pre-existing and unrelated to hosting — the same URLs fail
from a residential IP:

- **Motilal** — its May 2026 file 404s (its listing carries dead links).
- **Edelweiss** — its current file link 403s.

The sync reports failures per AMC and continues, so neither blocks the run.

## Database setup

The schema is applied with `push` (there is no `drizzle/` migrations
directory):

```bash
DATABASE_URL=<neon-direct-url> npx drizzle-kit push
```

## Local env files

`vercel env pull` writes `.env.local`, which **Next.js loads at higher
precedence than `.env`** — that silently points local dev at the cloud
database. Keep cloud credentials in `.env.vercel` instead, which Next does not
auto-load:

```bash
vercel env pull .env.vercel
```

`.env` stays pointed at the local docker-compose Postgres and pins
`STORAGE_DRIVER=local`.

## Verifying a deploy

1. `GET /api/dashboard` returns funds/stocks counts.
2. `POST /api/sync/Tata%20Mutual%20Fund` with the cron secret returns
   `{"ingested": 24, "holdings": 1260, "failed": 0}`.
3. `GET /api/cron/sync` without a secret returns 401.
4. New rows reach `status=done` on the upload page.
