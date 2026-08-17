"use client";

import { useCallback, useEffect, useState } from "react";

interface RunRow {
  id: number;
  trigger: string;
  status: string;
  amcs: number | null;
  schemeMonths: number | null;
  holdings: number | null;
  failed: number | null;
  advanced: string[];
  errorMsg: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

const STATUS_TONE: Record<string, string> = {
  running: "text-accent",
  done: "text-up",
  error: "text-down",
};

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duration(ms: number | null) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/runs", { cache: "no-store" });
    if (res.status === 401) {
      setLocked(true);
      return;
    }
    if (res.ok) {
      setLocked(false);
      setRuns((await res.json()).runs);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A run in flight only changes on the server, so poll while one is open.
  const pending = runs?.some((r) => r.status === "running") ?? false;
  useEffect(() => {
    if (!pending && !syncing) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [pending, syncing, load]);

  const signIn = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError(null);
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        setAuthError(d.error ?? "Sign-in failed");
      }
    },
    [password, load],
  );

  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg("Running — this takes about 30 seconds.");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "sync failed");
      setSyncMsg(
        data.advanced?.length
          ? `Done — new data: ${data.advanced.join("; ")}`
          : `Done — ${data.holdings} holdings, nothing newer was published.`,
      );
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
      await load();
    }
  }, [load]);

  if (locked) {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <h1 className="text-lg font-bold">Sync Runs</h1>
        <p className="text-xs text-muted">
          Triggering a sync rewrites every fund and hits nine AMC sites, so it sits
          behind a passphrase.
        </p>
        <form onSubmit={signIn} className="space-y-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin passphrase"
            className="w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm hover:border-accent"
          >
            Sign in
          </button>
        </form>
        {authError && <div className="text-xs text-down">{authError}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Sync Runs</h1>
        <button
          onClick={runSync}
          disabled={syncing}
          className="rounded-md border border-edge bg-panel px-3 py-1.5 text-xs hover:border-accent disabled:opacity-50"
        >
          {syncing ? "Running…" : "▶ Run sync now"}
        </button>
      </div>

      {syncMsg && <div className="text-xs text-muted">{syncMsg}</div>}

      <div className="rounded-md border border-edge bg-panel">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            History
          </h2>
          {pending && <span className="text-[10px] text-accent">in progress…</span>}
        </div>
        {/* Eight columns do not fit a phone; let the table scroll rather than
            the page, so the header and nav stay put. */}
        <div className="overflow-x-auto p-3">
          {runs === null ? (
            <div className="text-xs text-muted">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="text-xs text-muted">No runs recorded yet.</div>
          ) : (
            <table className="w-full min-w-[46rem] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-muted">
                  <th className="pb-1">Started</th>
                  <th className="pb-1">Trigger</th>
                  <th className="pb-1">Status</th>
                  <th className="pb-1 text-right">Took</th>
                  <th className="pb-1 text-right">Scheme-months</th>
                  <th className="pb-1 text-right">Holdings</th>
                  <th className="pb-1 text-right">Failed</th>
                  <th className="pb-1">New data</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-edge/60 align-top">
                    <td className="py-1.5 whitespace-nowrap">{when(r.startedAt)}</td>
                    <td className="py-1.5 text-muted">{r.trigger}</td>
                    <td className={`py-1.5 ${STATUS_TONE[r.status] ?? ""}`}>
                      {r.status}
                      {r.errorMsg && (
                        <div className="text-[10px] text-down/80">{r.errorMsg}</div>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {duration(r.durationMs)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.schemeMonths ?? "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.holdings ?? "—"}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${r.failed ? "text-down" : ""}`}
                    >
                      {r.failed ?? "—"}
                    </td>
                    <td className="py-1.5 text-muted">
                      {r.advanced.length ? (
                        r.advanced.map((a, i) => <div key={i}>{a}</div>)
                      ) : r.status === "done" ? (
                        <span className="text-muted/60">—</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
