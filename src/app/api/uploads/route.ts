import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db
    .select()
    .from(uploads)
    .orderBy(desc(uploads.createdAt))
    .limit(50);
  return NextResponse.json({ uploads: rows });
}
