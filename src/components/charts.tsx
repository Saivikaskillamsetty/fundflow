"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Dashboard, StockAgg } from "@/lib/types";

const UP = "#2ecc71";
const DOWN = "#ff5470";

function shortName(s: string) {
  return s.replace(/ (Ltd|Limited)\.?$/i, "");
}

export function MoversChart({ data }: { data: StockAgg[] }) {
  const rows = data.map((d) => ({
    name: shortName(d.name),
    value: Number(d.netDeltaPct.toFixed(2)),
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 26)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tick={{ fill: "#9aa4b2", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "#ffffff08" }}
          contentStyle={{
            background: "#11161f",
            border: "1px solid #1e2733",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value) => {
            const v = Number(value);
            return [`${v > 0 ? "+" : ""}${v}%`, "Net Δ weight"];
          }}
        />
        {/* Animation starts while ResponsiveContainer still measures 0 width,
            leaving zero-size bars until a resize forces a re-layout. */}
        <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.value >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SectorChart({
  data,
}: {
  data: { sector: string; netDeltaPct: number }[];
}) {
  const rows = data.map((d) => ({
    name: d.sector,
    value: Number(d.netDeltaPct.toFixed(2)),
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 26)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tick={{ fill: "#9aa4b2", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "#ffffff08" }}
          contentStyle={{
            background: "#11161f",
            border: "1px solid #1e2733",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value) => {
            const v = Number(value);
            return [`${v > 0 ? "+" : ""}${v}%`, "Net Δ weight"];
          }}
        />
        {/* Animation starts while ResponsiveContainer still measures 0 width,
            leaving zero-size bars until a resize forces a re-layout. */}
        <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.value >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Heatmap({ heatmap }: { heatmap: Dashboard["heatmap"] }) {
  const { funds, stocks, cells } = heatmap;
  if (!funds.length || !stocks.length)
    return <div className="text-xs text-muted">No activity to display.</div>;

  const cellMap = new Map<string, { signal: string; deltaPct: number }>();
  for (const c of cells) cellMap.set(`${c.fund}|${c.stock}`, c);

  const color = (d?: { signal: string; deltaPct: number }) => {
    if (!d) return "#0d1117";
    const a = Math.min(1, Math.abs(d.deltaPct) / 3);
    if (d.signal === "BUY") return `rgba(46,204,113,${0.15 + a * 0.7})`;
    if (d.signal === "SELL") return `rgba(255,84,112,${0.15 + a * 0.7})`;
    return "rgba(201,162,39,0.25)";
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-panel" />
            {funds.map((f) => (
              <th
                key={f}
                className="h-24 w-7 align-bottom text-muted"
                title={f}
              >
                <div className="rotate-180 [writing-mode:vertical-rl] whitespace-nowrap pb-1">
                  {f.replace(/ Fund$/, "")}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => (
            <tr key={s}>
              <td className="sticky left-0 max-w-[140px] truncate bg-panel pr-2 text-muted" title={s}>
                {s.replace(/ (Ltd|Limited)\.?$/i, "")}
              </td>
              {funds.map((f) => {
                const d = cellMap.get(`${f}|${s}`);
                return (
                  <td
                    key={f}
                    title={d ? `${f} · ${s}: ${d.signal} ${d.deltaPct.toFixed(2)}%` : `${f}: no position`}
                    className="h-6 w-7 rounded-sm"
                    style={{ background: color(d) }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
