"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

function label(m: string) {
  const [y, mo] = m.split("-").map(Number);
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[mo]} ${y}`;
}

export function MonthSelector({
  months,
  current,
}: {
  months: string[];
  current: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (months.length <= 1) {
    return current ? (
      <span className="text-xs text-muted">{label(current)}</span>
    ) : null;
  }

  const onChange = (m: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("month", m);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="uppercase tracking-wider">Month</span>
      <select
        value={current ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-edge bg-panel2 px-2 py-1 text-foreground outline-none hover:border-muted"
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {label(m)}
          </option>
        ))}
      </select>
    </label>
  );
}
