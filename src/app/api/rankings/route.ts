import { NextResponse } from "next/server";
import { getRankings } from "@/lib/conviction";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  const data = await getRankings(month);
  return NextResponse.json(data);
}
