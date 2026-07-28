import Link from "next/link";
import type { ReactNode } from "react";

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-edge bg-panel ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {title}
          </h2>
          {right}
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "up" | "down" | "accent";
}) {
  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
        ? "text-down"
        : tone === "accent"
          ? "text-accent"
          : "text-foreground";
  return (
    <div className="rounded-md border border-edge bg-panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

export function SignalBadge({ signal }: { signal: string | null }) {
  const map: Record<string, string> = {
    BUY: "bg-up/15 text-up border-up/30",
    SELL: "bg-down/15 text-down border-down/30",
    HOLD: "bg-hold/15 text-hold border-hold/30",
  };
  const cls = signal ? map[signal] ?? "" : "text-muted";
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${cls}`}
    >
      {signal ?? "—"}
    </span>
  );
}

export function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted">—</span>;
  const cls = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`tabular-nums ${cls}`}>
      {sign}
      {value.toFixed(2)}%
    </span>
  );
}

export function ConvictionBar({ value }: { value: number }) {
  // 50 = neutral; >50 accumulation (green), <50 distribution (red).
  const pct = Math.max(0, Math.min(100, value));
  const color = value >= 50 ? "var(--color-up)" : "var(--color-down)";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded bg-edge">
        <div className="h-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-7 text-right tabular-nums text-xs">{value}</span>
    </div>
  );
}

export function StockLink({ id, name }: { id: number; name: string }) {
  return (
    <Link href={`/stocks/${id}`} className="text-foreground hover:text-accent hover:underline">
      {name}
    </Link>
  );
}
