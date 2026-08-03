// Manual "sync now" trigger from the upload page.
//
// This used to enqueue a job for a worker on another host. It now fans out to
// one function per AMC and waits, so the response carries the real outcome
// instead of a job id nothing was guaranteed to consume.
import { NextResponse } from "next/server";
import { fanoutSync } from "@/lib/fanout";
import { selfOrigin } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  try {
    const summary = await fanoutSync(selfOrigin(request), secret);
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
