// Manual "sync now" trigger.
//
// This used to enqueue a job for a worker on another host, and was unauthenticated
// because enqueueing was cheap and nothing consumed the queue anyway. It now fans
// out to one function per AMC and does the work: ~30s of compute, tens of file
// downloads, and writes across every fund. Left open on a public deployment that
// is a denial-of-wallet endpoint and a way for anyone to force re-ingestion, so
// it requires the same secret as the cron entrypoint.
//
// The app itself has no user auth, so a browser cannot hold this secret — the
// upload page's sync button was removed rather than left to 401. Trigger a
// manual run with curl, or let the daily cron do it.
import { NextResponse } from "next/server";
import { fanoutSync } from "@/lib/fanout";
import { requireInternalAuth, selfOrigin, Unauthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    requireInternalAuth(request);
  } catch (err) {
    if (err instanceof Unauthorized) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  try {
    const summary = await fanoutSync(selfOrigin(request), process.env.CRON_SECRET!);
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
