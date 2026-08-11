// Where downloaded/uploaded portfolio workbooks live.
//
// Single-host deployments keep files under ./uploads and hand the parser that
// path directly. When the web app and the worker run on different machines
// (Next.js on Vercel, worker on a container host) they no longer share a disk,
// so files go to Vercel Blob and the parser materializes a temp copy instead.
//
// Driver is chosen by STORAGE_DRIVER, defaulting to blob whenever a blob token
// is present — so local dev stays on disk with no configuration.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function driver(): "blob" | "local" {
  const explicit = process.env.STORAGE_DRIVER;
  if (explicit === "blob" || explicit === "local") return explicit;
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
}

/** A stored reference is either an absolute local path or an https URL. */
export function isRemote(storedPath: string): boolean {
  return /^https?:\/\//i.test(storedPath);
}

/** Persist bytes; returns the stored reference to record on the upload row. */
export async function putFile(filename: string, body: Buffer): Promise<string> {
  if (driver() === "blob") {
    const { put } = await import("@vercel/blob");
    const { url } = await put(`uploads/${randomUUID()}-${filename}`, body, {
      access: "public",
      addRandomSuffix: false,
    });
    return url;
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const dest = path.join(UPLOAD_DIR, `${randomUUID()}-${filename}`);
  await writeFile(dest, body);
  return dest;
}

/**
 * Drop a stored file once it has served its purpose.
 *
 * A blob is only a transport: the Next function writes the workbook, the Python
 * function reads it, and after ingest nothing refers to it again. Left behind,
 * every sync re-uploads the same ~56 workbooks under fresh keys and the store
 * grows without bound.
 *
 * Never throws — failing to tidy up must not fail an ingest that succeeded.
 */
export async function deleteFile(storedPath: string): Promise<void> {
  if (!isRemote(storedPath)) return; // local files live under ./uploads, gitignored
  try {
    const { del } = await import("@vercel/blob");
    await del(storedPath);
  } catch (err) {
    // Orphaned blob. Not worth failing a completed ingest over, but silence
    // here is how a slow leak hides: a run that deletes 48 of 53 looks exactly
    // like one that deletes all 53.
    console.warn(
      `[storage] could not delete ${storedPath}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/** Basename of a URL path, percent-decoded, with a usable fallback. */
function decodeName(pathname: string): string {
  const base = path.basename(pathname);
  try {
    return decodeURIComponent(base) || "workbook";
  } catch {
    // Malformed escapes — the raw name is still better than nothing.
    return base || "workbook";
  }
}

export interface Materialized {
  /** Local filesystem path the Python parser can open. */
  path: string;
  /** Removes the temp copy, if one was made. Safe to call unconditionally. */
  cleanup: () => Promise<void>;
}

/**
 * Give the parser a real file on local disk. Local refs are used in place;
 * remote refs are fetched to a temp file the caller must clean up.
 */
export async function materialize(
  storedPath: string,
  preferredName?: string,
): Promise<Materialized> {
  if (!isRemote(storedPath)) {
    return { path: storedPath, cleanup: async () => {} };
  }
  const res = await fetch(storedPath);
  if (!res.ok) {
    throw new Error(`could not fetch stored file ${storedPath}: ${res.status}`);
  }
  // The temp file's name is load-bearing: the parser reads the reporting month
  // out of it when the workbook itself does not say, and silently falls back to
  // the current month when that fails. A URL pathname is percent-encoded, so
  // "30th June 2026" arrives as "30th%20June%202026", no month is found, and
  // holdings land under whatever month the sync happened to run in.
  const name = preferredName || decodeName(new URL(storedPath).pathname);
  const tmp = path.join(os.tmpdir(), `${randomUUID()}-${name}`);
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  return {
    path: tmp,
    cleanup: async () => {
      await unlink(tmp).catch(() => {});
    },
  };
}
