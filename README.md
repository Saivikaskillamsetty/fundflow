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
- **Parser**: Python (`pdfplumber` / `pandas`) invoked as a subprocess
- **Queue**: Redis + BullMQ (async parse jobs)
- **LLM**: pluggable via `LLM_PROVIDER` — `ollama` (free local), `groq` (free fast cloud, ~500 tok/s), or `anthropic` (paid Claude)

## Prerequisites

- Node 20.9+, Python 3.9+, Docker

## Setup

```bash
# 1. Infra
docker compose up -d                 # Postgres :5433, Redis :6380

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
npm run dev        # http://localhost:3000  (terminal 1)
npm run worker     # parse-job consumer     (terminal 2)
```

- `/` — dashboard: summary cards, top bought/sold, sector deltas, fund heatmap
- `/rankings` — strong institutional buying / selling, conviction-ranked
- `/stocks/[id]` — per-fund prev/current/action table + AI insight
- `/upload` — drop PDF/XLSX fact sheets; worker parses + ingests

## Auto-fetch latest portfolios (AMC sync)

Pulls the latest **monthly portfolio** workbook from AMC sites via headless
Chrome, then runs it through the same parse→ingest pipeline. A real AMC file is
one consolidated workbook (~40 sheets); the parser keeps only equity schemes
(filters debt/liquid via the Industry/Rating column + an equity-weight floor).

```bash
npm run sync            # fetch + enqueue (worker must be running)
# or the UI: /upload → "⟳ Sync latest from AMCs"
# or POST /api/sync
```

Requires Chrome (path overridable via `CHROME_PATH`). Sources live in
`src/lib/fetcher/amcs.ts`. Curated top funds per AMC in `topfunds.ts`.

**Verified live (`enabled: true`):**
- **Nippon** — consolidated monthly workbook, dated history (own site)
- **HDFC** — per-scheme files, prior month via folder/date rewrite (own S3)
- **Axis** — consolidated monthly workbook via AdvisorKhoj (own site is a WAF SPA)
- **Tata / Franklin Templeton / Motilal Oswal / Edelweiss / Quant** —
  consolidated monthly workbooks via the generic AdvisorKhoj route
  (`advisorKhojDiscover`): plain-fetch the AMC's download-centre page, date the
  links with a fuzzy month parser (filename formats vary wildly per AMC), keep
  the newest N distinct months within a recency window. Caveats: Motilal's
  listing has month gaps and occasionally dead links; Edelweiss/Axis lag the
  newest month.

**Not feasible for free, full holdings (`enabled: false`):**
- **SBI / ICICI** — only factsheet PDFs are public (summarized top holdings,
  chart-heavy, not parseable); full monthly-portfolio workbooks sit behind
  WAF-protected single-page apps that reject non-browser requests.
- **Kotak** — portfolio page is a JS SPA with no static links anywhere
  (own site + AdvisorKhoj both yield nothing).
- **Aditya Birla SL / UTI** — publish via AdvisorKhoj but only as ZIP bundles
  (zip extraction not supported yet).
- **DSP / Mirae / PPFAS / Canara Robeco / Bandhan** — nothing on AdvisorKhoj.

AdvisorKhoj (`advisorkhoj.com`) is the most reliable discovery surface — it is
not bot-protected and links straight to AMC files where the AMC publishes them.

### Scheduled monthly pipeline (installed)

`npm run sync:monthly` is a **self-contained** runner (discover → download →
parse → ingest → recompute signals, inline — no BullMQ worker needed). It is
scheduled via a macOS LaunchAgent that runs on the **12th of each month at 09:00**
(SEBI gives AMCs ~10 days after month-end to publish, so the 12th reliably has
the prior month — earlier dates can miss the just-closed month):

- Agent:   `~/Library/LaunchAgents/com.fundflow.monthly-sync.plist`
- Wrapper: `scripts/run-monthly-sync.sh` (sets PATH, cd, runs `sync:monthly`)
- Logs:    `logs/monthly-sync.log`

```bash
# manage
launchctl list | grep fundflow                                   # is it loaded?
launchctl kickstart gui/$(id -u)/com.fundflow.monthly-sync       # run now
launchctl bootout gui/$(id -u)/com.fundflow.monthly-sync         # disable
# change the day/time: edit StartCalendarInterval in the plist, then bootout + bootstrap
```

Requires Docker (Postgres) running and Chrome installed at launch time.
Linux alternative — cron: `0 9 12 * * cd <project> && npm run sync:monthly`.

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

## Notes / out of scope (phase 2)

- Real AMC monthly portfolios are often **Excel**, not PDF — the parser handles
  both. Fixtures are synthetic but match the SEBI-mandated layout exactly.
- Deferred: alerts, ZIP upload, OCR for scanned PDFs, S3 storage, separate
  FastAPI service, auth.
