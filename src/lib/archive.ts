// Some AMCs (Aditya Birla SL) publish the monthly portfolio as a ZIP bundle
// rather than a bare workbook. Expanding here rather than in the parser keeps
// the rest of the pipeline single-file: every member becomes its own upload row
// and its own parse job, so a bad member fails alone instead of failing the
// bundle.
import path from "node:path";
import { unzipSync } from "fflate";

export interface ArchiveEntry {
  filename: string;
  body: Buffer;
}

/** File types the Python extractor can open. */
const WORKBOOK = /\.(pdf|xlsx|xls)$/i;

/** Archive noise: macOS resource forks, directory entries, dotfiles. */
const JUNK = /(^|\/)(__MACOSX\/|\.)/;

/**
 * A .xlsx IS a zip container, so magic bytes alone would "expand" every
 * workbook into its internal XML parts. The extension is the only safe signal.
 */
export function isZip(filename: string): boolean {
  return /\.zip$/i.test(filename);
}

/**
 * Non-archives pass through untouched, so callers can wrap every download in
 * this without branching. Returns one entry per parseable member.
 */
export function expandArchive(filename: string, body: Buffer): ArchiveEntry[] {
  if (!isZip(filename)) return [{ filename, body }];

  let members: Record<string, Uint8Array>;
  try {
    members = unzipSync(body);
  } catch (err) {
    throw new Error(
      `could not read zip ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const entries: ArchiveEntry[] = [];
  const skipped: string[] = [];
  for (const [name, bytes] of Object.entries(members)) {
    if (name.endsWith("/") || JUNK.test(name)) continue;
    if (!WORKBOOK.test(name)) {
      skipped.push(name);
      continue;
    }
    // Flatten nested paths — the stored filename only needs to be recognizable,
    // and the AMC's directory layout carries no meaning downstream.
    entries.push({ filename: path.basename(name), body: Buffer.from(bytes) });
  }

  if (!entries.length) {
    const found = skipped.length ? skipped.slice(0, 5).join(", ") : "nothing";
    throw new Error(`zip ${filename} held no .pdf/.xlsx/.xls member (found: ${found})`);
  }
  return entries;
}
