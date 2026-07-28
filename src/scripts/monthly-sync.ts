// Self-contained monthly pipeline for cron/launchd: discover → download →
// parse → ingest → recompute signals, all inline. Does NOT require the BullMQ
// worker to be running (unlike `npm run sync`).
//
// Run: npm run sync:monthly
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { enabledSources } from "@/lib/fetcher/amcs";
import { fetchFile } from "@/lib/fetcher/headless";
import { putFile } from "@/lib/storage";
import { runParser } from "@/lib/parser";
import { ingestFund } from "@/lib/ingest";
import { isTopFund } from "@/lib/fetcher/topfunds";
import { recomputeAllSignals } from "@/lib/signals";

const log = (m: string) => console.log(`[monthly-sync] ${m}`);

async function main() {
  log(`start ${new Date().toISOString()}`);

  let files = 0;
  let funds = 0;
  let holdings = 0;

  for (const src of enabledSources()) {
    let items;
    try {
      items = await src.discover(src.months);
    } catch (err) {
      log(`${src.amc}: discover FAILED — ${err instanceof Error ? err.message : err}`);
      continue;
    }
    log(`${src.amc}: ${items.length} files`);

    for (const item of items) {
      // Row goes in first so a failed download still leaves an error trail;
      // the stored ref is only known once the bytes are persisted.
      const [row] = await db
        .insert(uploads)
        .values({ filename: item.filename, storedPath: "", status: "parsing" })
        .returning({ id: uploads.id });
      try {
        const dest = await putFile(item.filename, await fetchFile(item.url));
        await db
          .update(uploads)
          .set({ storedPath: dest })
          .where(eq(uploads.id, row.id));
        const parsed = await runParser(dest, item.fundNameHint, src.amc);
        const top = parsed.filter((f) => isTopFund(f.amc, f.fund_name));
        let n = 0;
        for (const f of top) n += (await ingestFund(f)).holdingsInserted;
        await db
          .update(uploads)
          .set({
            status: "done",
            amcDetected: src.amc,
            fundName: top.length > 1 ? `${top.length} schemes` : top[0]?.fund_name ?? null,
            reportMonth: top[0]?.report_month ?? null,
            holdingsCount: n,
          })
          .where(eq(uploads.id, row.id));
        files += 1;
        funds += top.length;
        holdings += n;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(uploads).set({ status: "error", errorMsg: msg }).where(eq(uploads.id, row.id));
        log(`  skip ${item.filename}: ${msg.slice(0, 80)}`);
      }
    }
  }

  // Final pass so month-over-month signals are correct regardless of order.
  await recomputeAllSignals();
  log(`done — ${files} files, ${funds} funds, ${holdings} holdings ingested`);
  process.exit(0);
}

main().catch((e) => {
  log(`FATAL ${e}`);
  process.exit(1);
});
