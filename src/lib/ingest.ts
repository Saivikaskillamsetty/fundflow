// Persist a parsed fund-month: fund row, stock identities, holdings.
// Then recompute signals + conviction for the affected month.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { funds, holdings } from "@/db/schema";
import { resolveStocks, stockKeyOf } from "@/lib/normalize";
import { computeSignalsForMonth, nextMonthOf } from "@/lib/signals";

export interface ParsedHolding {
  stock_name: string;
  isin?: string | null;
  sector?: string | null;
  holding_pct: number | null;
  market_value?: number | null;
  shares_held?: number | null;
}

export interface ParsedFund {
  amc: string;
  fund_name: string;
  category?: string | null;
  report_month: string; // YYYY-MM
  source_file?: string | null;
  holdings: ParsedHolding[];
}

export interface IngestResult {
  fundId: number;
  reportMonth: string;
  holdingsInserted: number;
}

export interface IngestOptions {
  /**
   * Recompute signals for the affected months after ingesting. Each pass wipes
   * and rebuilds a whole month across every fund, so bulk callers that finish
   * with `recomputeAllSignals()` should pass false — otherwise a 56-file sync
   * pays for 112 redundant full-month rebuilds.
   */
  recomputeSignals?: boolean;
}

export async function ingestFund(
  parsed: ParsedFund,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const { recomputeSignals = true } = options;
  // Upsert the fund entity by name (stable across months). Lookup is
  // case-insensitive: the same scheme can arrive as "Edelweiss Mid Cap Fund"
  // (index sheet) one month and "EDELWEISS MID CAP FUND" (statement banner)
  // another — those must map to one fund or month-over-month diffs break.
  // First-seen casing is kept.
  let fundId: number;
  const existing = await db
    .select({ id: funds.id })
    .from(funds)
    .where(sql`lower(${funds.name}) = ${parsed.fund_name.toLowerCase()}`)
    .limit(1);
  if (existing.length) {
    fundId = existing[0].id;
    await db
      .update(funds)
      .set({
        amc: parsed.amc,
        category: parsed.category ?? null,
        sourceFile: parsed.source_file ?? null,
      })
      .where(eq(funds.id, fundId));
  } else {
    const [fund] = await db
      .insert(funds)
      .values({
        amc: parsed.amc,
        name: parsed.fund_name,
        category: parsed.category ?? null,
        sourceFile: parsed.source_file ?? null,
      })
      .onConflictDoUpdate({
        target: funds.name,
        set: {
          amc: parsed.amc,
          category: parsed.category ?? null,
          sourceFile: parsed.source_file ?? null,
        },
      })
      .returning({ id: funds.id });
    fundId = fund.id;
  }

  // Replace any existing holdings for this fund-month (idempotent re-ingest).
  await db
    .delete(holdings)
    .where(
      and(
        eq(holdings.fundId, fundId),
        eq(holdings.reportMonth, parsed.report_month),
      ),
    );

  const usable = parsed.holdings.filter((h) => h.holding_pct != null);
  const stockIds = await resolveStocks(
    usable.map((h) => ({
      stock_name: h.stock_name,
      isin: h.isin,
      sector: h.sector,
    })),
  );

  // One row per stock: a workbook can list the same holding twice, and a single
  // INSERT cannot hit the same conflict target twice. Last occurrence wins,
  // matching the previous sequential-upsert behaviour.
  const rows = new Map<number, typeof holdings.$inferInsert>();
  for (const h of usable) {
    const stockId = stockIds.get(
      stockKeyOf({ stock_name: h.stock_name, isin: h.isin, sector: h.sector }),
    );
    if (stockId == null) continue;
    rows.set(stockId, {
      fundId,
      stockId,
      holdingPct: h.holding_pct as number,
      sharesHeld: h.shares_held ?? null,
      marketValue: h.market_value ?? null,
      reportMonth: parsed.report_month,
    });
  }

  const batch = [...rows.values()];
  const CHUNK = 500; // keeps bound parameters well under Postgres' 65535 limit
  for (let i = 0; i < batch.length; i += CHUNK) {
    await db
      .insert(holdings)
      .values(batch.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [holdings.fundId, holdings.stockId, holdings.reportMonth],
        set: {
          holdingPct: sql`excluded.holding_pct`,
          sharesHeld: sql`excluded.shares_held`,
          marketValue: sql`excluded.market_value`,
        },
      });
  }
  const inserted = batch.length;

  // Recompute this month (vs its prior) AND the next month (whose prior is
  // this one) so signals are correct regardless of ingest order.
  if (recomputeSignals) {
    await computeSignalsForMonth(parsed.report_month);
    await computeSignalsForMonth(nextMonthOf(parsed.report_month));
  }

  return { fundId, reportMonth: parsed.report_month, holdingsInserted: inserted };
}
