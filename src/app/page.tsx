import Link from "next/link";
import { getDashboard } from "@/lib/conviction";
import { Panel, StatCard, StockLink, Delta, ConvictionBar } from "@/components/ui";
import { MoversChart, SectorChart, Heatmap } from "@/components/charts";
import { MonthSelector } from "@/components/month-selector";
import type { StockAgg } from "@/lib/types";

export const dynamic = "force-dynamic";

function MoverTable({ rows }: { rows: StockAgg[] }) {
  if (!rows.length) return <div className="text-xs text-muted">No data.</div>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase text-muted">
          <th className="pb-1">Stock</th>
          <th className="pb-1 text-center">B / S</th>
          <th className="pb-1 text-right">Net Δ</th>
          <th className="pb-1 text-right">Conviction</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.stockId} className="border-t border-edge/60">
            <td className="py-1.5">
              <StockLink id={s.stockId} name={s.name} />
            </td>
            <td className="text-center tabular-nums">
              <span className="text-up">{s.fundsBuying}</span>
              <span className="text-muted">/</span>
              <span className="text-down">{s.fundsSelling}</span>
            </td>
            <td className="text-right">
              <Delta value={s.netDeltaPct} />
            </td>
            <td className="py-1.5">
              <div className="flex justify-end">
                <ConvictionBar value={s.conviction} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const d = await getDashboard(month);

  if (!d.month) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <h1 className="text-xl font-bold">No portfolios analyzed yet</h1>
        <p className="max-w-md text-sm text-muted">
          Upload mutual-fund fact sheets or monthly portfolio statements to detect
          institutional buying and selling.
        </p>
        <Link
          href="/upload"
          className="rounded border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent hover:bg-accent/20"
        >
          → Upload fact sheets
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-bold">Institutional Activity</h1>
        <div className="flex items-center gap-4">
          <MonthSelector months={d.months} current={d.month} />
          <Link href="/rankings" className="text-xs text-accent hover:underline">
            full rankings →
          </Link>
        </div>
      </div>
      {d.prevMonth === null && d.months.length > 1 && (
        <div className="text-[11px] text-hold">
          Earliest month — no prior month to compare, so all positions read as new (BUY).
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Funds Analyzed" value={d.cards.fundsAnalyzed} tone="accent" />
        <StatCard label="Stocks Tracked" value={d.cards.stocksFound} />
        <StatCard label="Strong Buys" value={d.cards.strongBuys} tone="up" />
        <StatCard label="Strong Sells" value={d.cards.strongSells} tone="down" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top Bought — Net Accumulation">
          <MoversChart data={d.topBought} />
        </Panel>
        <Panel title="Top Sold — Net Distribution">
          <MoversChart data={d.topSold} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Strong Institutional Buying">
          <MoverTable rows={d.topBought} />
        </Panel>
        <Panel title="Strong Institutional Selling">
          <MoverTable rows={d.topSold} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Sector Allocation Change" className="lg:col-span-2">
          <SectorChart data={d.sectorDeltas} />
        </Panel>
        <Panel title="Fund Activity Heatmap (top movers)" className="lg:col-span-3">
          <Heatmap heatmap={d.heatmap} />
        </Panel>
      </div>
    </div>
  );
}
