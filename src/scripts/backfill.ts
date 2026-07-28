// Backfill N most-recent months for all enabled AMCs (one-off / testing).
// Same inline pipeline as monthly-sync, but fetches `argv[2]` months (default 4).
// Optional argv[3]: comma-separated AMC name substrings to restrict the run.
// Run: npm run backfill -- 4
//      npm run backfill -- 6 "Tata,Quant"
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { enabledSources } from "@/lib/fetcher/amcs";
import { downloadFile } from "@/lib/fetcher/headless";
import { runParser } from "@/lib/parser";
import { ingestFund } from "@/lib/ingest";
import { isTopFund } from "@/lib/fetcher/topfunds";
import { recomputeAllSignals } from "@/lib/signals";

const MONTHS = Number(process.argv[2] || 4);
const AMC_FILTER = (process.argv[3] || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const log = (m: string) => console.log(`[backfill] ${m}`);

async function main() {
  log(`fetching latest ${MONTHS} months for all enabled AMCs`);
  await mkdir(UPLOAD_DIR, { recursive: true });
  let files = 0, funds = 0, holdings = 0;

  const sources = enabledSources().filter(
    (s) => !AMC_FILTER.length || AMC_FILTER.some((f) => s.amc.toLowerCase().includes(f)),
  );
  for (const src of sources) {
    let items;
    try {
      items = await src.discover(MONTHS);
    } catch (err) {
      log(`${src.amc}: discover FAILED — ${err instanceof Error ? err.message : err}`);
      continue;
    }
    log(`${src.amc}: ${items.length} files`);
    for (const item of items) {
      const dest = path.join(UPLOAD_DIR, `${randomUUID()}-${item.filename}`);
      const [row] = await db
        .insert(uploads)
        .values({ filename: item.filename, storedPath: dest, status: "parsing" })
        .returning({ id: uploads.id });
      try {
        await downloadFile(item.url, dest);
        const parsed = await runParser(dest, item.fundNameHint, src.amc);
        const top = parsed.filter((f) => isTopFund(f.amc, f.fund_name));
        let n = 0;
        for (const f of top) n += (await ingestFund(f)).holdingsInserted;
        await db.update(uploads).set({
          status: "done", amcDetected: src.amc,
          fundName: top.length > 1 ? `${top.length} schemes` : top[0]?.fund_name ?? null,
          reportMonth: top[0]?.report_month ?? null, holdingsCount: n,
        }).where(eq(uploads.id, row.id));
        files++; funds += top.length; holdings += n;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(uploads).set({ status: "error", errorMsg: msg }).where(eq(uploads.id, row.id));
        log(`  skip ${item.filename}: ${msg.slice(0, 70)}`);
      }
    }
  }
  await recomputeAllSignals();
  log(`done — ${files} files, ${funds} funds, ${holdings} holdings`);
  process.exit(0);
}

main().catch((e) => { log(`FATAL ${e}`); process.exit(1); });
