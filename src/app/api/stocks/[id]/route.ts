import { NextResponse } from "next/server";
import { getStockDetail } from "@/lib/conviction";
import { getCachedInsight } from "@/lib/insights";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stockId = Number(id);
  if (!Number.isFinite(stockId)) {
    return NextResponse.json({ error: "Invalid stock id" }, { status: 400 });
  }
  const detail = await getStockDetail(stockId);
  if (!detail) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }
  const insight = await getCachedInsight(stockId);
  return NextResponse.json({ ...detail, insight });
}
