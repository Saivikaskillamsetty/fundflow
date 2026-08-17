// Lifecycle of a sync run, so the app can say what happened rather than only
// what data exists.
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs } from "@/db/schema";
import type { FanoutSummary } from "@/lib/fanout";

export type RunTrigger = "cron" | "manual";

/** Open a run before any work, so an interrupted one leaves a trace. */
export async function startRun(trigger: RunTrigger): Promise<number> {
  const [row] = await db
    .insert(runs)
    .values({ trigger, status: "running" })
    .returning({ id: runs.id });
  return row.id;
}

export async function finishRun(
  id: number,
  summary: FanoutSummary,
  advanced: string[],
): Promise<void> {
  await db
    .update(runs)
    .set({
      status: "done",
      amcs: summary.amcs,
      schemeMonths: summary.ingested,
      holdings: summary.holdings,
      failed: summary.failed,
      advanced: JSON.stringify(advanced),
      finishedAt: new Date(),
    })
    .where(eq(runs.id, id));
}

export async function failRun(id: number, err: unknown): Promise<void> {
  await db
    .update(runs)
    .set({
      status: "error",
      errorMsg: err instanceof Error ? err.message : String(err),
      finishedAt: new Date(),
    })
    .where(eq(runs.id, id));
}

/**
 * A function that times out or is killed never closes its row, which would
 * otherwise show as "running" forever. Nothing can outlive the 300s ceiling by
 * much, so anything older than that is over — we just cannot say how it ended.
 */
export async function reapStaleRuns(): Promise<number> {
  const res = await db
    .update(runs)
    .set({
      status: "error",
      errorMsg: "run did not report back — the function likely timed out",
      finishedAt: new Date(),
    })
    .where(
      sql`${runs.status} = 'running' AND ${runs.startedAt} < now() - interval '10 minutes'`,
    )
    .returning({ id: runs.id });
  return res.length;
}

export interface RunRow {
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

export async function listRuns(limit = 50): Promise<RunRow[]> {
  await reapStaleRuns();
  const rows = await db
    .select()
    .from(runs)
    .orderBy(desc(runs.startedAt))
    .limit(limit);

  return rows.map((r) => {
    let advanced: string[] = [];
    try {
      advanced = r.advanced ? (JSON.parse(r.advanced) as string[]) : [];
    } catch {
      advanced = [];
    }
    return {
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      amcs: r.amcs,
      schemeMonths: r.schemeMonths,
      holdings: r.holdings,
      failed: r.failed,
      advanced,
      errorMsg: r.errorMsg,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      durationMs: r.finishedAt
        ? r.finishedAt.getTime() - r.startedAt.getTime()
        : null,
    };
  });
}
