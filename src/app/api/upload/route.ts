import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { parseQueue } from "@/lib/queue";

export const runtime = "nodejs";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const ALLOWED = /\.(pdf|xlsx|xls)$/i;

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const created: { id: number; filename: string }[] = [];

  for (const file of files) {
    if (!ALLOWED.test(file.name)) {
      // Record rejected file so the UI can show why.
      const [row] = await db
        .insert(uploads)
        .values({
          filename: file.name,
          storedPath: "",
          status: "error",
          errorMsg: "Unsupported file type (need .pdf, .xlsx, .xls)",
        })
        .returning({ id: uploads.id });
      created.push({ id: row.id, filename: file.name });
      continue;
    }

    const storedPath = path.join(UPLOAD_DIR, `${randomUUID()}-${file.name}`);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(storedPath, buf);

    const [row] = await db
      .insert(uploads)
      .values({ filename: file.name, storedPath, status: "queued" })
      .returning({ id: uploads.id });

    await parseQueue.add(
      "parse",
      { uploadId: row.id, storedPath, filename: file.name },
      { removeOnComplete: true, attempts: 1 },
    );
    created.push({ id: row.id, filename: file.name });
  }

  return NextResponse.json({ uploads: created });
}
