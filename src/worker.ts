// BullMQ worker: consume parse jobs, run the Python extractor, ingest results.
// Run with: npm run worker
import "dotenv/config";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { connection, PARSE_QUEUE, type ParseJob } from "@/lib/queue";
import { runParser } from "@/lib/parser";
import { ingestFund } from "@/lib/ingest";
import { isTopFund } from "@/lib/fetcher/topfunds";

const worker = new Worker<ParseJob>(
  PARSE_QUEUE,
  async (job) => {
    const { uploadId, storedPath, fundNameHint, amcHint } = job.data;
    await db
      .update(uploads)
      .set({ status: "parsing" })
      .where(eq(uploads.id, uploadId));

    try {
      const parsedFunds = await runParser(storedPath, fundNameHint, amcHint);
      // Curate: only ingest the AMC's top funds.
      const funds = parsedFunds.filter((f) => isTopFund(f.amc, f.fund_name));
      let totalHoldings = 0;
      for (const fund of funds) {
        const r = await ingestFund(fund);
        totalHoldings += r.holdingsInserted;
      }
      const first = funds[0];
      const label =
        funds.length > 1 ? `${funds.length} schemes` : (first?.fund_name ?? null);
      await db
        .update(uploads)
        .set({
          status: "done",
          amcDetected: first?.amc ?? null,
          fundName: label,
          reportMonth: first?.report_month ?? null,
          holdingsCount: totalHoldings,
          errorMsg: null,
        })
        .where(eq(uploads.id, uploadId));
      return { funds: funds.length, holdings: totalHoldings };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(uploads)
        .set({ status: "error", errorMsg: msg })
        .where(eq(uploads.id, uploadId));
      throw err;
    }
  },
  { connection, concurrency: 2 },
);

worker.on("completed", (job) =>
  console.log(`[worker] upload ${job.data.uploadId} done`),
);
worker.on("failed", (job, err) =>
  console.error(`[worker] upload ${job?.data.uploadId} failed:`, err.message),
);

console.log("[worker] FundFlow parse worker listening on", PARSE_QUEUE);
