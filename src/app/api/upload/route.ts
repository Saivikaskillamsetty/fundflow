// Manual upload intake. Files are stored, then parsed and ingested inline —
// a workbook parses in about a second, so there is nothing to defer to a queue.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { putFile } from "@/lib/storage";
import { expandArchive } from "@/lib/archive";
import { processUpload } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED = /\.(pdf|xlsx|xls|zip)$/i;

async function recordRejection(filename: string, errorMsg: string) {
  const [row] = await db
    .insert(uploads)
    .values({ filename, storedPath: "", status: "error", errorMsg })
    .returning({ id: uploads.id });
  return { id: row.id, filename };
}

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const created: { id: number; filename: string }[] = [];

  for (const file of files) {
    if (!ALLOWED.test(file.name)) {
      created.push(
        await recordRejection(
          file.name,
          "Unsupported file type (need .pdf, .xlsx, .xls, .zip)",
        ),
      );
      continue;
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // A ZIP fans out into one upload row per member; other types yield one.
    let entries;
    try {
      entries = expandArchive(file.name, buf);
    } catch (err) {
      created.push(
        await recordRejection(
          file.name,
          err instanceof Error ? err.message : String(err),
        ),
      );
      continue;
    }

    for (const entry of entries) {
      const storedPath = await putFile(entry.filename, entry.body);
      const [row] = await db
        .insert(uploads)
        .values({ filename: entry.filename, storedPath, status: "queued" })
        .returning({ id: uploads.id });
      created.push({ id: row.id, filename: entry.filename });

      // processUpload records its own failure on the row, so one bad file does
      // not abort the rest of the batch.
      await processUpload({
        uploadId: row.id,
        storedPath,
        filename: entry.filename,
      }).catch(() => {});
    }
  }

  return NextResponse.json({ uploads: created });
}
