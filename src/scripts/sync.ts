// Standalone sync runner for cron. Fetches latest portfolios + enqueues parse.
// Run: npm run sync   (worker must be running to process the jobs)
import "dotenv/config";
import { syncAll } from "@/lib/fetcher/sync";

async function main() {
  console.log(`[sync] ${new Date().toISOString()} starting`);
  const results = await syncAll();
  for (const r of results) {
    console.log(
      `[sync] ${r.amc}: queued ${r.queued}, failed ${r.failed}` +
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
