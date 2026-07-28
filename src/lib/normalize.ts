// Company-name normalization + stock identity resolution.
// ISIN is the authoritative key; name matching is the fallback.

import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { stocks } from "@/db/schema";

// Common ticker / short-form aliases seen in fact sheets.
const ALIASES: Record<string, string> = {
  ril: "Reliance Industries Ltd",
  "reliance industries": "Reliance Industries Ltd",
  hdfc: "HDFC Bank Ltd",
  tcs: "Tata Consultancy Services Ltd",
  "l&t": "Larsen & Toubro Ltd",
  "larsen and toubro": "Larsen & Toubro Ltd",
  sbi: "State Bank of India",
  hul: "Hindustan Unilever Ltd",
  itc: "ITC Ltd",
};

const SUFFIXES = [
  "limited", "ltd", "ltd.", "(india)", "india", "corporation", "corp",
  "company", "co", "co.", "the",
];

export function normalizeName(raw: string): string {
  let s = (raw || "").trim().replace(/\s+/g, " ");
  // Drop trailing footnote markers.
  s = s.replace(/[*#$@^]+$/g, "").trim();
  const lower = s.toLowerCase().replace(/[.,]/g, "").trim();
  if (ALIASES[lower]) return ALIASES[lower];
  return s;
}

// A key used only when ISIN is absent: lowercase, suffix-stripped, alnum-only.
export function nameKey(raw: string): string {
  let s = normalizeName(raw).toLowerCase();
  s = s.replace(/[.,&()]/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w && !SUFFIXES.includes(w));
  return words.join(" ");
}

export interface StockInput {
  stock_name: string;
  isin?: string | null;
  sector?: string | null;
}

/**
 * The identity `resolveStocks` resolves on: ISIN when present, canonical name
 * otherwise.
 */
export function stockKeyOf(input: StockInput): string {
  const isin = input.isin?.trim() || null;
  return isin ? `isin:${isin}` : `name:${normalizeName(input.stock_name)}`;
}

/**
 * Resolve (or create) canonical stock rows for a whole set of holdings.
 * Match priority per holding: ISIN -> canonical name -> create.
 *
 * This is deliberately set-at-a-time: a fund-month carries ~64 holdings and a
 * consolidated workbook many times that, so resolving one holding per query
 * costs thousands of sequential round trips — invisible against a local
 * database, ruinous against a remote one.
 *
 * Returns stock ids keyed by `stockKeyOf`.
 */
export async function resolveStocks(
  inputs: StockInput[],
): Promise<Map<string, number>> {
  const resolved = new Map<string, number>();
  if (!inputs.length) return resolved;

  // Collapse duplicates, preferring the record that carries a sector.
  const byKey = new Map<string, StockInput>();
  for (const input of inputs) {
    const key = stockKeyOf(input);
    const seen = byKey.get(key);
    if (!seen || (!seen.sector && input.sector)) byKey.set(key, input);
  }

  const wanted = [...byKey.values()];
  const isins = wanted
    .map((i) => i.isin?.trim())
    .filter((s): s is string => !!s);
  const names = wanted.map((i) => normalizeName(i.stock_name));

  const existing = await db
    .select()
    .from(stocks)
    .where(
      or(
        isins.length ? inArray(stocks.isin, isins) : undefined,
        names.length ? inArray(stocks.canonicalName, names) : undefined,
      ),
    );

  const foundByIsin = new Map(
    existing.filter((r) => r.isin).map((r) => [r.isin as string, r]),
  );
  const foundByName = new Map(existing.map((r) => [r.canonicalName, r]));

  // New rows are grouped by canonical name: a single INSERT cannot touch the
  // same conflict target twice, and two ISINs can normalize to one name.
  const pending = new Map<string, { isin: string | null; sector: string | null; keys: string[] }>();
  const backfills: Promise<unknown>[] = [];

  for (const [key, input] of byKey) {
    const isin = input.isin?.trim() || null;
    const canonicalName = normalizeName(input.stock_name);
    const hit = (isin ? foundByIsin.get(isin) : undefined) ?? foundByName.get(canonicalName);

    if (hit) {
      resolved.set(key, hit.id);
      if (!hit.sector && input.sector) {
        backfills.push(
          db.update(stocks).set({ sector: input.sector }).where(eq(stocks.id, hit.id)),
        );
      }
      if (isin && !hit.isin) {
        backfills.push(
          db.update(stocks).set({ isin }).where(eq(stocks.id, hit.id)),
        );
      }
      continue;
    }

    const group = pending.get(canonicalName);
    if (group) {
      group.keys.push(key);
      group.sector ??= input.sector || null;
      group.isin ??= isin;
    } else {
      pending.set(canonicalName, {
        isin,
        sector: input.sector || null,
        keys: [key],
      });
    }
  }

  if (pending.size) {
    const created = await db
      .insert(stocks)
      .values(
        [...pending].map(([canonicalName, g]) => ({
          canonicalName,
          isin: g.isin,
          sector: g.sector,
        })),
      )
      .onConflictDoUpdate({
        target: stocks.canonicalName,
        set: { sector: sql`excluded.sector` },
      })
      .returning({ id: stocks.id, canonicalName: stocks.canonicalName });

    for (const row of created) {
      for (const key of pending.get(row.canonicalName)?.keys ?? []) {
        resolved.set(key, row.id);
      }
    }
  }

  // Backfills are independent of each other, so pay one round trip, not N.
  await Promise.all(backfills);
  return resolved;
}
