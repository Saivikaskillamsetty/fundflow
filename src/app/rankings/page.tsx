import { getRankings } from "@/lib/conviction";
import { Panel, StockLink, Delta, ConvictionBar } from "@/components/ui";
import { MonthSelector } from "@/components/month-selector";
import type { StockAgg } from "@/lib/types";

export const dynamic = "force-dynamic";

function RankTable({ rows, mode }: { rows: StockAgg[]; mode: "buy" | "sell" }) {
  if (!rows.length) return <div className="text-xs text-muted">No data.</div>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase text-muted">
          <th className="pb-1 w-8">#</th>
          <th className="pb-1">Stock</th>
          <th className="pb-1">Sector</th>
          <th className="pb-1 text-center">{mode === "buy" ? "Funds Buying" : "Funds Selling"}</th>
          <th className="pb-1 text-right">Net Δ</th>
          <th className="pb-1 text-right">Conviction</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => (
          <tr key={s.stockId} className="border-t border-edge/60">
            <td className="py-1.5 tabular-nums text-muted">{i + 1}</td>
            <td className="py-1.5">
              <StockLink id={s.stockId} name={s.name} />
            </td>
            <td className="py-1.5 text-muted">{s.sector ?? "—"}</td>
            <td className="text-center tabular-nums font-bold">
              {mode === "buy" ? (
                <span className="text-up">{s.fundsBuying}</span>
              ) : (
                <span className="text-down">{s.fundsSelling}</span>
              )}
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

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const r = await getRankings(month);
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-bold">Conviction Rankings</h1>
        <MonthSelector months={r.months} current={r.month} />
      </div>
      <Panel title="Strong Institutional Buying">
        <RankTable rows={r.buying} mode="buy" />
      </Panel>
      <Panel title="Strong Institutional Selling">
        <RankTable rows={r.selling} mode="sell" />
      </Panel>
    </div>
  );
}
