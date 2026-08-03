// Monthly sync entrypoint, invoked by the Vercel cron in vercel.json.
//
// Hobby caps cron at once per day with ±59min precision, so this runs daily and
// decides for itself whether today is a sync day. SEBI gives AMCs ~10 days after
// month-end to publish, so the 12th reliably has the prior month.
import { NextResponse } from "next/server";
import { fanoutSync } from "@/lib/fanout";
import { requireInternalAuth, selfOrigin, Unauthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYNC_DAY = Number(process.env.SYNC_DAY_OF_MONTH ?? "12");

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
  if (!force && today !== SYNC_DAY) {
    return NextResponse.json({ skipped: true, today, syncDay: SYNC_DAY });
  }

  const summary = await fanoutSync(selfOrigin(request), process.env.CRON_SECRET!);
  return NextResponse.json(summary);
}
