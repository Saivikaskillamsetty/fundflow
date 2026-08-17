// Sync run history. Gated: run errors quote internal URLs and failure detail
// that the public dashboard has no reason to expose.
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { listRuns } from "@/lib/runs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!hasAdminSession(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ runs: await listRuns(50) });
}
