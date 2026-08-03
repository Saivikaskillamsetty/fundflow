# FundFlow Intelligence

Upload Indian mutual-fund fact sheets / monthly portfolio statements, extract
holdings, compare current vs previous month per fund, and classify each stock
position as **BUY / SELL / HOLD**. Aggregates cross-fund **conviction** and
surfaces it in a Bloomberg-style terminal with an LLM insight layer.

MVP vertical slice: **upload → parse → normalize → diff → signal → dashboard +
rankings + stock detail + AI summary**.

## Stack

- **App**: Next.js 16 (App Router, TS, Tailwind 4), Recharts, dark terminal UI
- **DB**: Postgres + Drizzle ORM
- **Parser**: Python (`pdfplumber` / `pymupdf` / `pandas`) — a subprocess locally, a Vercel Python Function in production
- **Hosting**: one Vercel project (Next.js + the Python parser + a monthly cron). No queue, no worker, no container.
- **LLM**: pluggable via `LLM_PROVIDER` — `ollama` (free local), `groq` (free fast cloud, ~500 tok/s), or `anthropic` (paid Claude)

## Prerequisites

- Node 20.9+, Python 3.9+, Docker

## Setup

```bash
# 1. Infra
docker compose up -d                 # Postgres :5433

# 2. Env (AI insights default to free local Ollama — no key needed)
cp .env.example .env
# Ollama: install from ollama.com, then: ollama pull gemma4 && ollama serve
# (or set LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY to use Claude instead)

# 3. Node deps
npm install

# 4. Python parser venv
python3 -m venv parser/.venv
parser/.venv/bin/pip install -r parser/requirements.txt

# 5. DB schema
npm run db:push

# 6. Sample data (generates fixture PDFs + seeds 2 months across 6 funds)
parser/.venv/bin/python parser/gen_fixtures.py
npm run seed
```

## Run

```bash
npm run dev        # http://localhost:3000
```

Uploads and syncs parse inline — there is no second process to run. Locally the
parser is invoked as a Python subprocess (`PYTHON_BIN`); deployed it is an HTTP
call to `api/parse.py`.

- `/` — dashboard: summary cards, top bought/sold, sector deltas, fund heatmap
- `/rankings` — strong institutional buying / selling, conviction-ranked
- `/stocks/[id]` — per-fund prev/current/action table + AI insight
- `/upload` — drop PDF/XLSX/ZIP fact sheets; parsed and ingested on the spot

## Auto-fetch latest portfolios (AMC sync)

Pulls the latest **monthly portfolio** workbook from AMC sites over plain HTTP,
then runs it through the same parse→ingest pipeline. A real AMC file is one
consolidated workbook (~40 sheets); the parser keeps only equity schemes
(filters debt/liquid via the Industry/Rating column + an equity-weight floor).

```bash
npm run sync            # all AMCs, sequentially, in this process
# or the UI: /upload → "⟳ Sync latest from AMCs"
# or POST /api/sync   (fans out to one function per AMC)
```

No browser required. Pages that looked like they needed one were doing
header-based bot checks, not JS rendering — `src/lib/fetcher/http.ts` sends a
full browser header set instead. Sources live in `src/lib/fetcher/amcs.ts`.
Curated top funds per AMC in `topfunds.ts`.

**Verified live (`enabled: true`):**
- **Nippon** — consolidated monthly workbook via AdvisorKhoj (own page renders links client-side)
- **HDFC** — per-scheme files (own S3). Its listing page 403s datacenter IPs, so
  deployed runs construct the URLs from a pinned scheme list; see DEPLOYMENT.md
- **Axis** — consolidated monthly workbook via AdvisorKhoj (own site is a WAF SPA)
- **Tata / Franklin Templeton / Motilal Oswal / Edelweiss / Quant** —
  consolidated monthly workbooks via the generic AdvisorKhoj route
  (`advisorKhojDiscover`): plain-fetch the AMC's download-centre page, date the
  links with a fuzzy month parser (filename formats vary wildly per AMC), keep
  the newest N distinct months within a recency window. Caveats: Motilal's
  listing has month gaps and occasionally dead links (its May 2026 file 404s);
  Edelweiss/Axis lag the newest month, and Edelweiss's current file link 403s.
  Both reproduce from a residential IP, so they are the AMCs' problem, not a
  hosting one — the sync reports them per-AMC and carries on.

- **Aditya Birla SL** — consolidated monthly workbook inside a **ZIP** bundle,
  unwrapped by `src/lib/archive.ts` before parsing. Its 74-scheme workbook is
  mostly debt/index, so `topfunds.ts` curates it down to ~24 equity schemes.

**Not feasible for free, full holdings (`enabled: false`):**
- **SBI / ICICI** — only factsheet PDFs are public (summarized top holdings,
  chart-heavy, not parseable); full monthly-portfolio workbooks sit behind
  WAF-protected single-page apps that reject non-browser requests.
- **Kotak** — portfolio page is a JS SPA with no static links anywhere
  (own site + AdvisorKhoj both yield nothing).
- **UTI** — publishes ZIPs on AdvisorKhoj, but only two exist and the newest is
  Feb 2026. Enabling it would inject a stale, isolated month rather than extend
  the timeline, so it stays off until the listing refreshes.
- **DSP / Mirae / PPFAS / Canara Robeco / Bandhan** — nothing on AdvisorKhoj.

AdvisorKhoj (`advisorkhoj.com`) is the most reliable discovery surface — it is
not bot-protected and links straight to AMC files where the AMC publishes them.

### Scheduled monthly pipeline

Deployed, this is a **Vercel cron** (`vercel.json` → `/api/cron/sync`). Hobby
allows one run per day, so the cron fires daily and the route syncs only on
`SYNC_DAY_OF_MONTH` (default the **12th** — SEBI gives AMCs ~10 days after
month-end, so the 12th reliably has the prior month).

It fans out to one function invocation per AMC, in parallel, so wall time is the
slowest AMC rather than the sum. Trigger a run by hand:

```bash
curl "https://fundflow-beta.vercel.app/api/cron/sync?force=1" \
  -H "authorization: Bearer $CRON_SECRET"
```

Locally, `npm run sync:monthly` runs the same pipeline in one process. The old
macOS LaunchAgent is no longer needed — remove it with:

```bash
launchctl bootout gui/$(id -u)/com.fundflow.monthly-sync
rm ~/Library/LaunchAgents/com.fundflow.monthly-sync.plist
```

## How it works

- **Parser** (`parser/extract.py`): detects the AMC, finds the SEBI-standard
  equity table (`Name | ISIN | Industry | Quantity | Market Value | % to Net
  Assets`) via a header-synonym map, filters non-equity rows (cash, T-bills,
  TREPS, totals), and emits JSON. Handles both PDF and XLSX.
- **Identity** (`src/lib/normalize.ts`): stocks matched by **ISIN first**, then
  normalized name (suffix-stripped, alias-mapped).
- **Signals** (`src/lib/signals.ts`): per (fund, stock), `Δ% to net assets` vs
  the prior month → BUY/SELL/HOLD at a `SIGNAL_THRESHOLD` (default 0.10%).
  New position = BUY, exited position = SELL.
- **Conviction** (`src/lib/conviction.ts`): cross-fund net Δ weight per stock,
  scaled 0–100 (50 = neutral).
- **Archives** (`src/lib/archive.ts`): ZIP bundles are unwrapped at download /
  upload time, so each member becomes its own upload row and parse job. Detection
  is by extension, never magic bytes — an `.xlsx` is itself a ZIP container.

## Tests

```bash
npm test          # vitest, one pass
npm run test:watch
```

The suite that earns its keep is `src/lib/__tests__/parser-fixtures.test.ts`:
it runs `extract.py` over all 12 fixture PDFs and asserts holdings counts and
per-ISIN weights against `parser/fixtures/dataset.json`. `extract.py` finds the
equity table by matching header synonyms, and when a synonym stops matching it
does not crash — it silently returns fewer rows, and fewer rows produce
confident but wrong signals. Exact-count assertions are the only thing that
catches that.

It needs the parser venv (setup step 4); without it those tests skip rather
than fail. CI (`.github/workflows/ci.yml`) builds the venv and runs typecheck,
lint, tests, and build on every push and PR.

## Notes / out of scope (phase 2)

- Real AMC monthly portfolios are often **Excel**, not PDF — the parser handles
  both. Fixtures are synthetic but match the SEBI-mandated layout exactly.
- Deferred: alerts, OCR for scanned PDFs, S3 storage, separate FastAPI service,
  auth.
