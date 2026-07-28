// Sync orchestrator: discover → download → enqueue the latest N months of
// monthly portfolios for each enabled AMC. Reuses the existing parse pipeline.
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { parseQueue } from "@/lib/queue";
import { fetchFile } from "@/lib/fetcher/headless";
import { putFile } from "@/lib/storage";
import { enabledSources, type AmcSource } from "@/lib/fetcher/amcs";

export interface SyncResult {
  amc: string;
  queued: number;
  failed: number;
  errors: string[];
}

async function syncSource(src: AmcSource): Promise<SyncResult> {
  const res: SyncResult = { amc: src.amc, queued: 0, failed: 0, errors: [] };
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
  for (const item of items) {
    try {
      const dest = await putFile(item.filename, await fetchFile(item.url));
      const [row] = await db
        .insert(uploads)
        .values({ filename: item.filename, storedPath: dest, status: "queued" })
        .returning({ id: uploads.id });
      await parseQueue.add(
        "parse",
        {
          uploadId: row.id,
          storedPath: dest,
          filename: item.filename,
          fundNameHint: item.fundNameHint,
          amcHint: src.amc,
        },
        { removeOnComplete: true, attempts: 1 },
      );
      res.queued += 1;
    } catch (err) {
      // Skip individual file failures (e.g. a prior-month file that 404s).
      res.failed += 1;
      if (res.errors.length < 5) {
        res.errors.push(
          `${item.filename}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return res;
}

/** Fetch latest months for every enabled AMC (sequential — headless is heavy). */
export async function syncAll(): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const src of enabledSources()) {
    results.push(await syncSource(src));
  }
  return results;
}
