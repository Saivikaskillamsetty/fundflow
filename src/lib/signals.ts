// Month-over-month classification per (fund, stock).
// delta_pct (change in % to net assets) is the primary driver.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { holdings, signals } from "@/db/schema";

export type SignalType = "BUY" | "SELL" | "HOLD";

const THRESHOLD = Number(process.env.SIGNAL_THRESHOLD ?? "0.10");

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + by);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const prevMonthOf = (month: string) => shiftMonth(month, -1);
export const nextMonthOf = (month: string) => shiftMonth(month, 1);

export function classify(deltaPct: number): SignalType {
  if (deltaPct > THRESHOLD) return "BUY";
  if (deltaPct < -THRESHOLD) return "SELL";
  return "HOLD";
}

interface Row {
  fundId: number;
  stockId: number;
  holdingPct: number;
  sharesHeld: number | null;
  marketValue: number | null;
}

async function holdingsForMonth(month: string): Promise<Row[]> {
  return db
    .select({
      fundId: holdings.fundId,
      stockId: holdings.stockId,
      holdingPct: holdings.holdingPct,
      sharesHeld: holdings.sharesHeld,
      marketValue: holdings.marketValue,
    })
    .from(holdings)
    .where(eq(holdings.reportMonth, month));
}

const key = (r: { fundId: number; stockId: number }) => `${r.fundId}:${r.stockId}`;

/**
 * Recompute every (fund, stock) signal for `month` vs the prior month.
 * Covers three cases: new position (BUY), exited position (SELL), and
 * continued position (delta-based classification).
 */
export async function computeSignalsForMonth(month: string): Promise<number> {
  const prev = prevMonthOf(month);
  const [curr, before] = await Promise.all([
    holdingsForMonth(month),
    holdingsForMonth(prev),
  ]);

  // Clear prior signals for this month so re-ingest stays idempotent.
  await db.delete(signals).where(eq(signals.reportMonth, month));

  // No holdings for this month → no signals (avoids phantom all-SELL months
  // when recomputing the "next month" before its data has arrived).
  if (curr.length === 0) return 0;

  const beforeMap = new Map(before.map((r) => [key(r), r]));
  const currMap = new Map(curr.map((r) => [key(r), r]));
  // Funds that actually reported this month. A fund with prior-month holdings
  // but no current-month report hasn't exited its positions — its data just
  // hasn't arrived yet — so it must not generate phantom SELLs.
  const reportedFunds = new Set(curr.map((r) => r.fundId));
  // Mirror guard for BUYs: a fund with no prior-month report has no baseline,
  // so its positions are "unknown delta", not all-new BUYs. Skipping avoids a
  // BUY flood for every fund's first month / data gaps.
  const prevReportedFunds = new Set(before.map((r) => r.fundId));

  const toInsert: (typeof signals.$inferInsert)[] = [];

  for (const c of curr) {
    if (!prevReportedFunds.has(c.fundId)) continue;
    const p = beforeMap.get(key(c));
    const prevPct = p?.holdingPct ?? 0;
    const deltaPct = c.holdingPct - prevPct;
    toInsert.push({
      fundId: c.fundId,
      stockId: c.stockId,
      reportMonth: month,
      prevMonth: prev,
      signal: classify(deltaPct),
      deltaPct,
      deltaShares:
        c.sharesHeld != null && p?.sharesHeld != null
          ? c.sharesHeld - p.sharesHeld
          : null,
      deltaValue:
        c.marketValue != null && p?.marketValue != null
          ? c.marketValue - p.marketValue
          : null,
    });
  }

  // Positions present last month but exited this month -> SELL.
  for (const p of before) {
    if (currMap.has(key(p))) continue;
    if (!reportedFunds.has(p.fundId)) continue;
    toInsert.push({
      fundId: p.fundId,
      stockId: p.stockId,
      reportMonth: month,
      prevMonth: prev,
      signal: "SELL",
      deltaPct: -p.holdingPct,
      deltaShares: p.sharesHeld != null ? -p.sharesHeld : null,
      deltaValue: p.marketValue != null ? -p.marketValue : null,
    });
  }

  if (toInsert.length) {
    // chunked insert to stay under parameter limits
    for (let i = 0; i < toInsert.length; i += 500) {
      await db
        .insert(signals)
        .values(toInsert.slice(i, i + 500))
        .onConflictDoNothing();
    }
  }
  return toInsert.length;
}

// Recompute signals for every distinct month present in holdings.
export async function recomputeAllSignals(): Promise<void> {
  const months = await db
    .selectDistinct({ m: holdings.reportMonth })
    .from(holdings);
  for (const { m } of months) {
    await computeSignalsForMonth(m);
  }
}
