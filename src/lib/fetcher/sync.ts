// Sync orchestrator: discover → download → parse → ingest the latest N months
// of monthly portfolios for one AMC.
//
// Previously this only enqueued jobs for a separate worker to pick up. The work
// now runs inline, one AMC per function invocation, so each AMC gets its own
// duration budget and a failure is contained to that AMC.
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { fetchFile } from "@/lib/fetcher/http";
import { putFile } from "@/lib/storage";
import { expandArchive } from "@/lib/archive";
import { processUpload } from "@/lib/pipeline";
import { recomputeAllSignals } from "@/lib/signals";
import { enabledSources, type AmcSource } from "@/lib/fetcher/amcs";

export interface SyncResult {
  amc: string;
  ingested: number;
  holdings: number;
  failed: number;
  errors: string[];
}

export async function syncSource(src: AmcSource): Promise<SyncResult> {
  const res: SyncResult = {
    amc: src.amc,
    ingested: 0,
    holdings: 0,
    failed: 0,
    errors: [],
  };

  let items;
  try {
    items = await src.discover(src.months);
  } catch (err) {
    res.failed = 1;
    res.errors.push(err instanceof Error ? err.message : String(err));
    return res;
  }
  if (!items.length) {
    res.errors.push("no files discovered");
    return res;
  }

  const handle = async (item: (typeof items)[number]) => {
    try {
      const downloaded = await fetchFile(item.url);
      // ZIP bundles fan out into one upload row per member; everything else is
      // a single-entry passthrough.
      for (const entry of expandArchive(item.filename, downloaded)) {
        const dest = await putFile(entry.filename, entry.body);
        const [row] = await db
          .insert(uploads)
          .values({ filename: entry.filename, storedPath: dest, status: "queued" })
          .returning({ id: uploads.id });

        const r = await processUpload({
          uploadId: row.id,
          storedPath: dest,
          filename: entry.filename,
          fundNameHint: item.fundNameHint,
          amcHint: src.amc,
          // Deferred to a single pass once every AMC has landed — see fanout.ts
          // and syncAll().
          recomputeSignals: false,
        });
        res.ingested += r.funds;
        res.holdings += r.holdings;
      }
    } catch (err) {
      // Skip individual file failures (e.g. a prior-month file that 404s).
      res.failed += 1;
      if (res.errors.length < 5) {
        res.errors.push(
          `${item.filename}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  await inBatches(items, FILE_CONCURRENCY, handle);
  return res;
}

/**
 * Files within an AMC are independent, and each costs ~6s end to end
 * (download → parse → ingest). HDFC publishes one workbook per scheme, so a
 * sequential pass over its ~44 files lands near the 300s function ceiling.
 * Modest concurrency keeps it comfortably inside without hammering the AMC's
 * CDN or opening a large number of database connections.
 */
const FILE_CONCURRENCY = Number(process.env.SYNC_FILE_CONCURRENCY ?? "4");

async function inBatches<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

/** Look up an enabled source by AMC name (case-insensitive). */
export function findSource(amc: string): AmcSource | undefined {
  return enabledSources().find((s) => s.amc.toLowerCase() === amc.toLowerCase());
}

/**
 * Sequential all-AMC sync. Used by the CLI scripts; the HTTP path fans out to
 * one invocation per AMC instead, so no single function carries the whole run.
 * Signals are rebuilt once at the end, so ingest order does not matter.
 */
export async function syncAll(): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const src of enabledSources()) {
    results.push(await syncSource(src));
  }
  await recomputeAllSignals();
  return results;
}
