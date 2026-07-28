// Company-name normalization + stock identity resolution.
// ISIN is the authoritative key; name matching is the fallback.

import { eq } from "drizzle-orm";
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
 * Resolve (or create) the canonical stock row for a holding.
 * Match priority: ISIN -> exact canonical name -> name key.
 */
export async function upsertStock(input: StockInput): Promise<number> {
  const canonicalName = normalizeName(input.stock_name);
  const isin = input.isin?.trim() || null;

  if (isin) {
    const [byIsin] = await db
      .select()
      .from(stocks)
      .where(eq(stocks.isin, isin))
      .limit(1);
    if (byIsin) {
      // Backfill sector if missing.
      if (!byIsin.sector && input.sector) {
        await db
          .update(stocks)
          .set({ sector: input.sector })
          .where(eq(stocks.id, byIsin.id));
      }
      return byIsin.id;
    }
  }

  // Fallback: match by canonical name (only safe when no ISIN conflict).
  const [byName] = await db
    .select()
    .from(stocks)
    .where(eq(stocks.canonicalName, canonicalName))
    .limit(1);
  if (byName) {
    // If this row lacked an ISIN and we now have one, attach it.
    if (isin && !byName.isin) {
      await db.update(stocks).set({ isin }).where(eq(stocks.id, byName.id));
    }
    return byName.id;
  }

  const [created] = await db
    .insert(stocks)
    .values({
      canonicalName,
      isin,
      sector: input.sector || null,
    })
    .onConflictDoUpdate({
      target: stocks.canonicalName,
      set: { sector: input.sector || null },
    })
    .returning({ id: stocks.id });
  return created.id;
}
