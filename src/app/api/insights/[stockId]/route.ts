import { NextResponse } from "next/server";
import { generateInsight } from "@/lib/insights";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ stockId: string }> },
) {
  const { stockId } = await params;
  const id = Number(stockId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid stock id" }, { status: 400 });
  }
  try {
    const body = await generateInsight(id);
    return NextResponse.json({ insight: body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
