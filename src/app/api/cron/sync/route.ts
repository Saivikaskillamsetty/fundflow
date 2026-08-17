// Monthly sync entrypoint, invoked by the Vercel cron in vercel.json.
//
// Hobby caps cron at once per day with ±59min precision, so this runs daily and
// decides for itself whether to work.
//
// It runs across a *window* of days rather than one. SEBI gives AMCs ~10 days
// after month-end, but they publish on a stagger — HDFC posts days before
// Motilal — and a single-day run silently skips whoever is late. Because
// `months: 2` only ever looks at the two newest months, a straggler missed in
// one run can be superseded before the next, leaving a permanent gap. Re-ingest
// is an upsert, so repeating within the window is free of side effects.
import { NextResponse } from "next/server";
import { fanoutSync } from "@/lib/fanout";
import { newestMonthByAmc, sendSyncReport } from "@/lib/report-email";
import { failRun, finishRun, startRun } from "@/lib/runs";
import { requireInternalAuth, selfOrigin, Unauthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The canonical monthly report day — the one run that always emails. */
const SYNC_DAY = Number(process.env.SYNC_DAY_OF_MONTH ?? "12");
const WINDOW_START = Number(process.env.SYNC_WINDOW_START ?? "10");
const WINDOW_END = Number(process.env.SYNC_WINDOW_END ?? "20");

export async function GET(request: Request) {
  try {
    requireInternalAuth(request);
  } catch (err) {
    if (err instanceof Unauthorized) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  // `force=1` runs it off-schedule, which is how you trigger a run by hand.
  const force = new URL(request.url).searchParams.get("force") === "1";
  const today = new Date().getUTCDate();
  if (!force && (today < WINDOW_START || today > WINDOW_END)) {
    return NextResponse.json({
      skipped: true,
      today,
      window: [WINDOW_START, WINDOW_END],
    });
  }

  const runId = await startRun("cron");
  let summary;
  let advanced: string[];
  try {
    const before = await newestMonthByAmc();
    summary = await fanoutSync(selfOrigin(request), process.env.CRON_SECRET!);
    const after = await newestMonthByAmc();

    advanced = Object.entries(after)
      .filter(([amc, month]) => before[amc] !== month)
      .map(([amc, month]) => `${amc}: ${before[amc] ?? "none"} → ${month}`);
    await finishRun(runId, summary, advanced);
  } catch (err) {
    await failRun(runId, err);
    throw err;
  }

  // Running eleven times a month must not mean eleven emails. Report when there
  // is news, and once on the canonical day so a silent month is still confirmed
  // rather than merely assumed.
  const shouldEmail = advanced.length > 0 || today === SYNC_DAY || force;
  const email = shouldEmail
    ? await sendSyncReport(summary, advanced)
    : { sent: false, reason: "no new months; not the report day" };

  return NextResponse.json({ runId, ...summary, advanced, email });
}
