// Persist a parsed fund-month: fund row, stock identities, holdings.
// Then recompute signals + conviction for the affected month.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { funds, holdings } from "@/db/schema";
import { upsertStock } from "@/lib/normalize";
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

export async function ingestFund(parsed: ParsedFund): Promise<IngestResult> {
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

  let inserted = 0;
  for (const h of parsed.holdings) {
    if (h.holding_pct == null) continue;
    const stockId = await upsertStock({
      stock_name: h.stock_name,
      isin: h.isin,
      sector: h.sector,
    });
    await db
      .insert(holdings)
      .values({
        fundId,
        stockId,
        holdingPct: h.holding_pct,
        sharesHeld: h.shares_held ?? null,
        marketValue: h.market_value ?? null,
        reportMonth: parsed.report_month,
      })
      .onConflictDoUpdate({
        target: [holdings.fundId, holdings.stockId, holdings.reportMonth],
        set: {
          holdingPct: h.holding_pct,
          sharesHeld: h.shares_held ?? null,
          marketValue: h.market_value ?? null,
        },
      });
    inserted += 1;
  }

  // Recompute this month (vs its prior) AND the next month (whose prior is
  // this one) so signals are correct regardless of ingest order.
  await computeSignalsForMonth(parsed.report_month);
  await computeSignalsForMonth(nextMonthOf(parsed.report_month));

  return { fundId, reportMonth: parsed.report_month, holdingsInserted: inserted };
}
