// Load bundled fixture dataset so the dashboard is populated on first run.
// Run: npm run seed
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ingestFund, type ParsedFund } from "@/lib/ingest";

async function main() {
  const datasetPath = path.join(
    process.cwd(),
    "parser",
    "fixtures",
    "dataset.json",
  );
  const raw = await readFile(datasetPath, "utf8");
  const dataset = JSON.parse(raw) as ParsedFund[];

  // Ingest in chronological order per fund so month-over-month diffs resolve.
  const sorted = [...dataset].sort((a, b) =>
    a.report_month.localeCompare(b.report_month),
  );

  let total = 0;
  for (const fund of sorted) {
    const res = await ingestFund(fund);
    total += res.holdingsInserted;
    console.log(
      `ingested ${fund.fund_name} ${fund.report_month}: ${res.holdingsInserted} holdings`,
    );
  }
  console.log(`\nDone. ${sorted.length} fund-months, ${total} holdings.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
