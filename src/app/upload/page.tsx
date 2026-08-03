"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadRow } from "@/lib/types";

const STATUS_TONE: Record<string, string> = {
  queued: "text-muted",
  parsing: "text-accent",
  done: "text-up",
  error: "text-down",
};

export default function UploadPage() {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/uploads", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setRows(data.uploads);
    }
  }, []);

  // Poll the upload queue while anything is still in flight. The fetch is
  // inlined rather than reusing `refresh` so the state update is visibly owned
  // by this effect, and `cancelled` keeps a response that lands after unmount
  // from setting state on a dead component.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const res = await fetch("/api/uploads", { cache: "no-store" });
      if (cancelled || !res.ok) return;
      const data = await res.json();
      if (!cancelled) setRows(data.uploads);
    };

    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      setBusy(true);
      const fd = new FormData();
      for (const f of list) fd.append("files", f);
      try {
        await fetch("/api/upload", { method: "POST", body: fd });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const pending = rows.some((r) => r.status === "queued" || r.status === "parsing");

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "sync failed");
      // The worker does discovery + downloads; rows appear here as it goes.
      setSyncMsg("Sync started on the worker — files will appear below as they download.");
      await refresh();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Upload Fact Sheets</h1>
        <button
          onClick={sync}
          disabled={syncing}
          className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          title="Fetch latest monthly portfolios from AMC sites (headless)"
        >
          {syncing ? "Syncing latest…" : "⟳ Sync latest from AMCs"}
        </button>
      </div>
      {syncMsg && <div className="text-xs text-muted">{syncMsg}</div>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed py-16 text-center transition-colors ${
          dragging ? "border-accent bg-accent/5" : "border-edge bg-panel hover:border-muted"
        }`}
      >
        <div className="text-3xl text-muted">⬆</div>
        <div className="text-sm">
          {busy ? "Uploading…" : "Drop PDF / XLSX fact sheets here, or click to browse"}
        </div>
        <div className="text-[10px] text-muted">
          SBI · HDFC · ICICI · Axis · Nippon · Kotak · any AMC (SEBI-standard layout)
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>

      <div className="rounded-md border border-edge bg-panel">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Upload Queue
          </h2>
          {pending && <span className="text-[10px] text-accent">processing…</span>}
        </div>
        <div className="p-3">
          {rows.length === 0 ? (
            <div className="text-xs text-muted">No uploads yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-muted">
                  <th className="pb-1">File</th>
                  <th className="pb-1">Status</th>
                  <th className="pb-1">Fund</th>
                  <th className="pb-1">Month</th>
                  <th className="pb-1 text-right">Holdings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-edge/60 align-top">
                    <td className="py-1.5 max-w-[260px] truncate" title={r.filename}>
                      {r.filename}
                    </td>
                    <td className={`py-1.5 ${STATUS_TONE[r.status] ?? ""}`}>
                      {r.status}
                      {r.status === "error" && r.errorMsg && (
                        <div className="text-[10px] text-down/80">{r.errorMsg}</div>
                      )}
                    </td>
                    <td className="py-1.5 text-muted">{r.fundName ?? "—"}</td>
                    <td className="py-1.5 text-muted">{r.reportMonth ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {r.holdingsCount ?? "—"}
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
