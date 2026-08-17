// Manual "sync now" trigger.
//
// This used to enqueue a job for a worker on another host, and was unauthenticated
// because enqueueing was cheap and nothing consumed the queue anyway. It now fans
// out to one function per AMC and does the work: ~30s of compute, tens of file
// downloads, and writes across every fund. Left open on a public deployment that
// is a denial-of-wallet endpoint and a way for anyone to force re-ingestion.
//
// Two callers are allowed: an operator holding the admin session cookie (the
// button on /runs), and anything holding CRON_SECRET (curl, the cron itself).
import { NextResponse } from "next/server";
import { fanoutSync } from "@/lib/fanout";
import { hasAdminSession } from "@/lib/admin-auth";
import { newestMonthByAmc } from "@/lib/report-email";
import { failRun, finishRun, startRun } from "@/lib/runs";
import { requireInternalAuth, selfOrigin, Unauthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!hasAdminSession(request)) {
    try {
      requireInternalAuth(request);
    } catch (err) {
      if (err instanceof Unauthorized) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      throw err;
    }
  }

  const runId = await startRun("manual");
  try {
    const before = await newestMonthByAmc();
    const summary = await fanoutSync(selfOrigin(request), process.env.CRON_SECRET!);
    const after = await newestMonthByAmc();
    const advanced = Object.entries(after)
      .filter(([amc, month]) => before[amc] !== month)
      .map(([amc, month]) => `${amc}: ${before[amc] ?? "none"} → ${month}`);

    await finishRun(runId, summary, advanced);
    return NextResponse.json({ runId, ...summary, advanced });
  } catch (err) {
    await failRun(runId, err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ runId, error: msg }, { status: 500 });
  }
}
