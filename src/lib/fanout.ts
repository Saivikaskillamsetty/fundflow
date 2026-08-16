// Fan a sync out to one function invocation per AMC, in parallel.
//
// Sequentially, a full run is the sum of every AMC's work and HDFC alone is
// ~44 workbooks — uncomfortably close to the 300s ceiling. Fanned out, the
// caller's wall time is the slowest single AMC rather than the total, and a
// slow or broken source cannot starve the others.
import { enabledSources } from "@/lib/fetcher/amcs";
import { internalHeaders } from "@/lib/internal-auth";
import { recomputeAllSignals } from "@/lib/signals";
import type { SyncResult } from "@/lib/fetcher/sync";

export interface FanoutSummary {
  amcs: number;
  /** Scheme-months across every AMC — see SyncResult.ingested. */
  ingested: number;
  holdings: number;
  failed: number;
  results: SyncResult[];
}

export async function fanoutSync(
  origin: string,
  secret: string,
): Promise<FanoutSummary> {
  const settled = await Promise.allSettled(
    enabledSources().map(async (src): Promise<SyncResult> => {
      const res = await fetch(
        `${origin}/api/sync/${encodeURIComponent(src.amc)}`,
        { method: "POST", headers: internalHeaders(secret) },
      );
      if (!res.ok) {
        throw new Error(`${src.amc}: HTTP ${res.status}`);
      }
      // Deployment protection answers with an HTML login page and a 200, so a
      // bare .json() surfaces as "Unexpected token '<'" — which says nothing
      // about the actual cause. Name it instead.
      const type = res.headers?.get?.("content-type") ?? "";
      if (!type.includes("application/json")) {
        throw new Error(
          `${src.amc}: expected JSON, got ${type || "unknown"} — the self-call is ` +
            `probably hitting deployment protection rather than the function`,
        );
      }
      return (await res.json()) as SyncResult;
    }),
  );

  const results: SyncResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          amc: enabledSources()[i].amc,
          ingested: 0,
          holdings: 0,
          failed: 1,
          errors: [s.reason instanceof Error ? s.reason.message : String(s.reason)],
        },
  );

  // Each per-AMC invocation skips signal recomputation, so one pass here covers
  // the whole run — and it must happen after every AMC has landed, since a
  // month's signals depend on the prior month being complete.
  await recomputeAllSignals();

  return {
    amcs: results.length,
    ingested: results.reduce((n, r) => n + r.ingested, 0),
    holdings: results.reduce((n, r) => n + r.holdings, 0),
    failed: results.reduce((n, r) => n + r.failed, 0),
    results,
  };
}
