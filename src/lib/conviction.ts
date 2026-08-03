// Read-time aggregation: cross-fund conviction + dashboard/ranking/detail data.

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { funds, holdings, signals, stocks } from "@/db/schema";

export interface StockAgg {
  stockId: number;
  name: string;
  sector: string | null;
  isin: string | null;
  fundsBuying: number;
  fundsSelling: number;
  fundsHolding: number;
  netDeltaPct: number; // sum of delta_pct across funds
  totalWeight: number; // sum of current holding_pct across funds
  conviction: number; // 0-100, 50 = neutral
}

export async function getLatestMonth(): Promise<string | null> {
  const [row] = await db
    .select({ m: sql<string>`max(${holdings.reportMonth})` })
    .from(holdings);
  return row?.m ?? null;
}

/** Distinct report months present, newest first. */
export async function getMonths(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ m: holdings.reportMonth })
    .from(holdings);
  return rows.map((r) => r.m).sort((a, b) => b.localeCompare(a));
}

/**
 * Per-stock cross-fund aggregates for a month, with a 0-100 conviction score.
 * Score: 50 + 50 * (netDelta / maxAbsNetDelta) so 50 is neutral, >50 net
 * accumulation, <50 net distribution.
 */
export async function getStockAggregates(month: string): Promise<StockAgg[]> {
  const rows = await db
    .select({
      stockId: signals.stockId,
      name: stocks.canonicalName,
      sector: stocks.sector,
      isin: stocks.isin,
      fundsBuying: sql<number>`sum(case when ${signals.signal} = 'BUY' then 1 else 0 end)`,
      fundsSelling: sql<number>`sum(case when ${signals.signal} = 'SELL' then 1 else 0 end)`,
      fundsHolding: sql<number>`sum(case when ${signals.signal} = 'HOLD' then 1 else 0 end)`,
      netDeltaPct: sql<number>`sum(${signals.deltaPct})`,
    })
    .from(signals)
    .innerJoin(stocks, eq(stocks.id, signals.stockId))
    .where(eq(signals.reportMonth, month))
    .groupBy(signals.stockId, stocks.canonicalName, stocks.sector, stocks.isin);

  // Current total weight per stock (sum across funds this month).
  const weightRows = await db
    .select({
      stockId: holdings.stockId,
      totalWeight: sql<number>`sum(${holdings.holdingPct})`,
    })
    .from(holdings)
    .where(eq(holdings.reportMonth, month))
    .groupBy(holdings.stockId);
  const weightMap = new Map(weightRows.map((r) => [r.stockId, Number(r.totalWeight)]));

  const maxAbs = Math.max(
    1e-9,
    ...rows.map((r) => Math.abs(Number(r.netDeltaPct))),
  );

  return rows
    .map((r) => {
      const net = Number(r.netDeltaPct);
      const conviction = Math.round(
        Math.min(100, Math.max(0, 50 + (50 * net) / maxAbs)),
      );
      return {
        stockId: r.stockId,
        name: r.name,
        sector: r.sector,
        isin: r.isin,
        fundsBuying: Number(r.fundsBuying),
        fundsSelling: Number(r.fundsSelling),
        fundsHolding: Number(r.fundsHolding),
        netDeltaPct: net,
        totalWeight: weightMap.get(r.stockId) ?? 0,
        conviction,
      } satisfies StockAgg;
    })
    .sort((a, b) => b.netDeltaPct - a.netDeltaPct);
}

export interface Dashboard {
  month: string | null;
  months: string[];
  prevMonth: string | null;
  cards: {
    fundsAnalyzed: number;
    stocksFound: number;
    strongBuys: number;
    strongSells: number;
  };
  topBought: StockAgg[];
  topSold: StockAgg[];
  sectorDeltas: { sector: string; netDeltaPct: number }[];
  heatmap: {
    funds: string[];
    stocks: string[];
    cells: { fund: string; stock: string; signal: string; deltaPct: number }[];
  };
}

export async function getDashboard(selected?: string): Promise<Dashboard> {
  const months = await getMonths();
  const month = selected && months.includes(selected) ? selected : months[0] ?? null;
  // The preceding month that actually has data, not the preceding calendar
  // month — an ingestion gap would otherwise name a month nothing exists for.
  // `months` is newest-first, so the next entry is the prior one; null means
  // this is the earliest month and every position necessarily reads as new.
  const prevMonth = month ? (months[months.indexOf(month) + 1] ?? null) : null;
  if (!month) {
    return {
      month: null,
      months,
      prevMonth: null,
      cards: { fundsAnalyzed: 0, stocksFound: 0, strongBuys: 0, strongSells: 0 },
      topBought: [],
      topSold: [],
      sectorDeltas: [],
      heatmap: { funds: [], stocks: [], cells: [] },
    };
  }

  const aggs = await getStockAggregates(month);

  const [{ fundCount }] = await db
    .select({ fundCount: sql<number>`count(distinct ${holdings.fundId})` })
    .from(holdings)
    .where(eq(holdings.reportMonth, month));

  const strongBuys = aggs.filter(
    (a) => a.fundsBuying > a.fundsSelling && a.fundsBuying >= 2,
  ).length;
  const strongSells = aggs.filter(
    (a) => a.fundsSelling > a.fundsBuying && a.fundsSelling >= 2,
  ).length;

  // Sector net delta.
  const sectorMap = new Map<string, number>();
  for (const a of aggs) {
    const s = a.sector || "Unclassified";
    sectorMap.set(s, (sectorMap.get(s) ?? 0) + a.netDeltaPct);
  }
  const sectorDeltas = [...sectorMap.entries()]
    .map(([sector, netDeltaPct]) => ({ sector, netDeltaPct }))
    .sort((a, b) => Math.abs(b.netDeltaPct) - Math.abs(a.netDeltaPct));

  // Heatmap: top movers x funds.
  const topStockIds = [...aggs]
    .sort((a, b) => Math.abs(b.netDeltaPct) - Math.abs(a.netDeltaPct))
    .slice(0, 10)
    .map((a) => a.stockId);

  const heatRows = topStockIds.length
    ? await db
        .select({
          fund: funds.name,
          stock: stocks.canonicalName,
          signal: signals.signal,
          deltaPct: signals.deltaPct,
        })
        .from(signals)
        .innerJoin(funds, eq(funds.id, signals.fundId))
        .innerJoin(stocks, eq(stocks.id, signals.stockId))
        .where(
          sql`${signals.reportMonth} = ${month} and ${signals.stockId} in (${sql.join(
            topStockIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
    : [];

  const heatFunds = [...new Set(heatRows.map((r) => r.fund))];
  const heatStocks = topStockIds
    .map((id) => aggs.find((a) => a.stockId === id)?.name)
    .filter((x): x is string => Boolean(x));

  return {
    month,
    months,
    prevMonth,
    cards: {
      fundsAnalyzed: Number(fundCount),
      stocksFound: aggs.length,
      strongBuys,
      strongSells,
    },
    topBought: aggs.filter((a) => a.netDeltaPct > 0).slice(0, 10),
    topSold: [...aggs].reverse().filter((a) => a.netDeltaPct < 0).slice(0, 10),
    sectorDeltas: sectorDeltas.slice(0, 10),
    heatmap: {
      funds: heatFunds,
      stocks: heatStocks,
      cells: heatRows.map((r) => ({
        fund: r.fund,
        stock: r.stock,
        signal: r.signal,
        deltaPct: Number(r.deltaPct),
      })),
    },
  };
}

export interface Rankings {
  month: string | null;
  months: string[];
  buying: StockAgg[];
  selling: StockAgg[];
}

export async function getRankings(selected?: string): Promise<Rankings> {
  const months = await getMonths();
  const month = selected && months.includes(selected) ? selected : months[0] ?? null;
  if (!month) return { month: null, months, buying: [], selling: [] };
  const aggs = await getStockAggregates(month);
  return {
    month,
    months,
    buying: aggs
      .filter((a) => a.netDeltaPct > 0)
      .sort((a, b) => b.conviction - a.conviction || b.fundsBuying - a.fundsBuying)
      .slice(0, 25),
    selling: aggs
      .filter((a) => a.netDeltaPct < 0)
      .sort((a, b) => a.conviction - b.conviction || b.fundsSelling - a.fundsSelling)
      .slice(0, 25),
  };
}

export interface StockDetail {
  stock: { id: number; name: string; sector: string | null; isin: string | null };
  month: string | null;
  agg: StockAgg | null;
  rows: {
    fund: string;
    amc: string;
    prevPct: number | null;
    currPct: number | null;
    signal: string | null;
    deltaPct: number | null;
  }[];
}

export async function getStockDetail(stockId: number): Promise<StockDetail | null> {
  const [stock] = await db
    .select()
    .from(stocks)
    .where(eq(stocks.id, stockId))
    .limit(1);
  if (!stock) return null;

  const month = await getLatestMonth();
  const agg = month
    ? (await getStockAggregates(month)).find((a) => a.stockId === stockId) ?? null
    : null;

  // Per-fund prev/current/action for the latest month.
  const rows = month
    ? await db
        .select({
          fund: funds.name,
          amc: funds.amc,
          currPct: holdings.holdingPct,
          signal: signals.signal,
          deltaPct: signals.deltaPct,
        })
        .from(signals)
        .innerJoin(funds, eq(funds.id, signals.fundId))
        .leftJoin(
          holdings,
          sql`${holdings.fundId} = ${signals.fundId} and ${holdings.stockId} = ${signals.stockId} and ${holdings.reportMonth} = ${month}`,
        )
        .where(
          sql`${signals.stockId} = ${stockId} and ${signals.reportMonth} = ${month}`,
        )
        .orderBy(desc(signals.deltaPct))
    : [];

  return {
    stock: { id: stock.id, name: stock.canonicalName, sector: stock.sector, isin: stock.isin },
    month,
    agg,
    rows: rows.map((r) => ({
      fund: r.fund,
      amc: r.amc,
      currPct: r.currPct != null ? Number(r.currPct) : null,
      prevPct:
        r.currPct != null && r.deltaPct != null
          ? Number(r.currPct) - Number(r.deltaPct)
          : r.deltaPct != null
            ? -Number(r.deltaPct)
            : null,
      signal: r.signal,
      deltaPct: r.deltaPct != null ? Number(r.deltaPct) : null,
    })),
  };
}
