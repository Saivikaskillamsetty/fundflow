// Sync exactly one AMC. Internal — invoked by the fan-out in /api/cron/sync so
// each AMC gets its own function invocation and its own duration budget. HDFC
// alone pulls ~44 per-scheme workbooks, which is why the whole run is not done
// in a single function.
import { NextResponse } from "next/server";
import { findSource, syncSource } from "@/lib/fetcher/sync";
import { requireInternalAuth, Unauthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ amc: string }> },
) {
  try {
    requireInternalAuth(request);
  } catch (err) {
    if (err instanceof Unauthorized) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const { amc } = await params;
  const src = findSource(decodeURIComponent(amc));
  if (!src) {
    return NextResponse.json({ error: `unknown or disabled AMC: ${amc}` }, { status: 404 });
  }

  const result = await syncSource(src);
  return NextResponse.json(result);
}
