// The temp file's name is load-bearing: extract.py reads the reporting month
// out of it when the workbook does not say, and falls back to the *current*
// month when that fails. A percent-encoded name therefore does not error — it
// silently files holdings under the month the sync happened to run in.
import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { materialize } from "@/lib/storage";

const BLOB =
  "https://x.public.blob.vercel-storage.com/uploads/" +
  "abc-Monthly%20Portfolio%20as%20on%2030th%20June%202026.xlsx";

function mockBlob(body = "data") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("materialize", () => {
  it("percent-decodes the name taken from a blob URL", async () => {
    mockBlob();
    const f = await materialize(BLOB);
    expect(path.basename(f.path)).toContain("Monthly Portfolio as on 30th June 2026.xlsx");
    expect(path.basename(f.path)).not.toContain("%20");
    await f.cleanup();
  });

  it("prefers the caller's filename over the URL", async () => {
    mockBlob();
    const f = await materialize(BLOB, "Monthly Portfolio as on 31st May 2026.xlsx");
    expect(path.basename(f.path)).toContain("31st May 2026");
    await f.cleanup();
  });

  it("writes the body and removes it on cleanup", async () => {
    mockBlob("hello");
    const f = await materialize(BLOB);
    expect(await readFile(f.path, "utf8")).toBe("hello");
    await f.cleanup();
    await expect(unlink(f.path)).rejects.toThrow();
  });

  it("passes a local path through untouched", async () => {
    const f = await materialize("/tmp/already-here.xlsx");
    expect(f.path).toBe("/tmp/already-here.xlsx");
    await f.cleanup();
  });
});
