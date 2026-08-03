// Standalone sync runner: discover → download → parse → ingest, sequentially
// across every enabled AMC. Run: npm run sync
//
// The deployed path fans out to one function per AMC instead (see
// src/lib/fanout.ts); this is the local/manual equivalent and needs no queue.
import "dotenv/config";
import { syncAll } from "@/lib/fetcher/sync";

async function main() {
  console.log(`[sync] ${new Date().toISOString()} starting`);
  const results = await syncAll();
  for (const r of results) {
    console.log(
      `[sync] ${r.amc}: ${r.ingested} schemes, ${r.holdings} holdings, ${r.failed} failed` +
        (r.errors.length ? ` — ${r.errors[0]}` : ""),
    );
  }
  console.log("[sync] done");
  process.exit(0);
}

main().catch((e) => {
  console.error("[sync] fatal", e);
  process.exit(1);
});
