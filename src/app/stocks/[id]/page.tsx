import Link from "next/link";
import { notFound } from "next/navigation";
import { getStockDetail } from "@/lib/conviction";
import { getCachedInsight } from "@/lib/insights";
import { Panel, StatCard, SignalBadge, Delta, ConvictionBar } from "@/components/ui";
import { InsightPanel } from "@/components/insight-panel";

export const dynamic = "force-dynamic";

export default async function StockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stockId = Number(id);
  if (!Number.isFinite(stockId)) notFound();

  const detail = await getStockDetail(stockId);
  if (!detail) notFound();
  const insight = await getCachedInsight(stockId);

  const { stock, agg, rows, month } = detail;
  const netTone = (agg?.netDeltaPct ?? 0) >= 0 ? "up" : "down";

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-xs text-accent hover:underline">
          ← terminal
        </Link>
        <h1 className="mt-1 text-xl font-bold">{stock.name}</h1>
        <div className="text-xs text-muted">
          {stock.sector ?? "Unclassified"} · ISIN {stock.isin ?? "n/a"} · {month}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Funds Buying" value={agg?.fundsBuying ?? 0} tone="up" />
        <StatCard label="Funds Selling" value={agg?.fundsSelling ?? 0} tone="down" />
        <StatCard
          label="Net Δ Weight"
          value={`${(agg?.netDeltaPct ?? 0) > 0 ? "+" : ""}${(agg?.netDeltaPct ?? 0).toFixed(2)}%`}
          tone={netTone}
        />
        <StatCard label="Conviction" value={agg?.conviction ?? 50} tone="accent" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Per-Fund Activity" className="lg:col-span-3">
          {rows.length ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-muted">
                  <th className="pb-1">Fund</th>
                  <th className="pb-1">AMC</th>
                  <th className="pb-1 text-right">Prev %</th>
                  <th className="pb-1 text-right">Curr %</th>
                  <th className="pb-1 text-right">Δ</th>
                  <th className="pb-1 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-edge/60">
                    <td className="py-1.5">{r.fund}</td>
                    <td className="py-1.5 text-muted">{r.amc}</td>
                    <td className="text-right tabular-nums text-muted">
                      {r.prevPct != null ? `${r.prevPct.toFixed(2)}%` : "—"}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.currPct != null ? `${r.currPct.toFixed(2)}%` : "0.00%"}
                    </td>
                    <td className="text-right">
                      <Delta value={r.deltaPct} />
                    </td>
                    <td className="py-1.5 text-center">
                      <SignalBadge signal={r.signal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-muted">No fund activity for this month.</div>
          )}
        </Panel>

        <Panel title="AI Insight" className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-[10px] uppercase text-muted">Net trend</span>
            <ConvictionBar value={agg?.conviction ?? 50} />
          </div>
          <InsightPanel stockId={stockId} initial={insight} />
        </Panel>
      </div>
    </div>
  );
}
