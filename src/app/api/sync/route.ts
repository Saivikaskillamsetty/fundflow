import { NextResponse } from "next/server";
import { syncAll } from "@/lib/fetcher/sync";

export const runtime = "nodejs";
export const maxDuration = 300; // headless discovery + downloads are slow

export async function POST() {
  try {
    const results = await syncAll();
    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
