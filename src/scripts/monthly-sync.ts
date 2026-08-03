// Monthly pipeline as a CLI: discover → download → parse → ingest → recompute
// signals, across every enabled AMC. Run: npm run sync:monthly
//
// Deployed, this runs as a Vercel cron that fans out to one function per AMC
// (src/app/api/cron/sync). This script is the same pipeline in one process, for
// running it by hand or from a machine that is not Vercel. It no longer
// duplicates the pipeline — syncAll() is the single implementation.
import "dotenv/config";
import { syncAll } from "@/lib/fetcher/sync";

const log = (m: string) => console.log(`[monthly-sync] ${m}`);

async function main() {
  log(`start ${new Date().toISOString()}`);

  const results = await syncAll();

  let funds = 0;
  let holdings = 0;
  let failed = 0;
  for (const r of results) {
    funds += r.ingested;
    holdings += r.holdings;
    failed += r.failed;
    log(
      `${r.amc}: ${r.ingested} schemes, ${r.holdings} holdings, ${r.failed} failed` +
        (r.errors.length ? ` — ${r.errors[0].slice(0, 80)}` : ""),
    );
  }

  log(`done — ${funds} schemes, ${holdings} holdings, ${failed} failures`);
  process.exit(0);
}

main().catch((e) => {
  log(`FATAL ${e}`);
  process.exit(1);
});
