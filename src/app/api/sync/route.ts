import { NextResponse } from "next/server";
import { syncQueue } from "@/lib/queue";

export const runtime = "nodejs";

// Discovery drives headless Chrome and downloads tens of workbooks, which
// outlives any function timeout — so this only enqueues. The worker (which has
// Chrome and the Python parser) does the work; poll /api/uploads for progress.
export async function POST() {
  try {
    const job = await syncQueue.add(
      "sync",
      { requestedAt: new Date().toISOString() },
      { removeOnComplete: true, attempts: 1 },
    );
    return NextResponse.json({ queued: true, jobId: job.id }, { status: 202 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
