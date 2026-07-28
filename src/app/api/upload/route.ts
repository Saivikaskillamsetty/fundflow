import { NextResponse } from "next/server";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { parseQueue } from "@/lib/queue";
import { putFile } from "@/lib/storage";

export const runtime = "nodejs";

const ALLOWED = /\.(pdf|xlsx|xls)$/i;

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

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

    const buf = Buffer.from(await file.arrayBuffer());
    const storedPath = await putFile(file.name, buf);

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
