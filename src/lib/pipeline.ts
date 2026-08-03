// Parse one stored file and ingest its schemes.
//
// This was the body of the BullMQ worker. With the parser reachable over HTTP
// there is nothing left that needs a resident process — a single workbook parses
// in about a second — so callers run it inline and the queue is gone.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { runParser } from "@/lib/parser";
import { ingestFund } from "@/lib/ingest";
import { isTopFund } from "@/lib/fetcher/topfunds";

export interface ProcessResult {
  funds: number;
  holdings: number;
}

/**
 * Parse `storedPath`, ingest the curated schemes, and drive the upload row's
 * status. Throws on failure, having already recorded the error on the row.
 */
export async function processUpload(opts: {
  uploadId: number;
  storedPath: string;
  filename: string;
  fundNameHint?: string;
  amcHint?: string;
  /**
   * Rebuild signals for the affected months as each scheme lands. True for a
   * one-off upload; bulk callers pass false and finish the whole run with a
   * single `recomputeAllSignals()`, since each pass rebuilds an entire month
   * across every fund.
   */
  recomputeSignals?: boolean;
}): Promise<ProcessResult> {
  const {
    uploadId,
    storedPath,
    filename,
    fundNameHint,
    amcHint,
    recomputeSignals = true,
  } = opts;

  await db.update(uploads).set({ status: "parsing" }).where(eq(uploads.id, uploadId));

  try {
    const parsedFunds = await runParser(storedPath, fundNameHint, amcHint, filename);
    // Curate: only ingest the AMC's top funds.
    const funds = parsedFunds.filter((f) => isTopFund(f.amc, f.fund_name));

    let totalHoldings = 0;
    for (const fund of funds) {
      const r = await ingestFund(fund, { recomputeSignals });
      totalHoldings += r.holdingsInserted;
    }

    const first = funds[0];
    const label = funds.length > 1 ? `${funds.length} schemes` : (first?.fund_name ?? null);
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
}
