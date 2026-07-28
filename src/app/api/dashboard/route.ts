import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/conviction";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  const data = await getDashboard(month);
  return NextResponse.json(data);
}
