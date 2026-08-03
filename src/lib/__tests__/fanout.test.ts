// The fan-out's job is containment: one AMC failing must not lose the others'
// results, and the run must still finish. That behaviour is invisible until an
// AMC breaks in production, which is exactly when it matters.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recomputeAllSignals = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/signals", () => ({ recomputeAllSignals }));

import { fanoutSync } from "@/lib/fanout";
import { enabledSources } from "@/lib/fetcher/amcs";

const ORIGIN = "https://deployment.vercel.app";
const SECRET = "s3cr3t";

const ok = (amc: string, ingested = 10, holdings = 100) => ({
  amc,
  ingested,
  holdings,
  failed: 0,
  errors: [] as string[],
});

beforeEach(() => recomputeAllSignals.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("fanoutSync", () => {
  it("calls one endpoint per enabled AMC, authenticated", async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return { ok: true, status: 200, json: async () => ok("x") };
      }),
    );

    await fanoutSync(ORIGIN, SECRET);

    expect(calls).toHaveLength(enabledSources().length);
    for (const [url, init] of calls) {
      expect(url.startsWith(`${ORIGIN}/api/sync/`)).toBe(true);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${SECRET}`,
      );
    }
  });

  it("URL-encodes AMC names, which all contain spaces", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => ok("x") };
      }),
    );

    await fanoutSync(ORIGIN, SECRET);
    expect(urls.every((u) => !u.includes(" "))).toBe(true);
    expect(urls.some((u) => u.includes("%20"))).toBe(true);
  });

  it("totals the per-AMC results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ok("x", 3, 30),
      })),
    );

    const n = enabledSources().length;
    const s = await fanoutSync(ORIGIN, SECRET);
    expect(s.amcs).toBe(n);
    expect(s.ingested).toBe(3 * n);
    expect(s.holdings).toBe(30 * n);
    expect(s.failed).toBe(0);
  });

  it("keeps the other AMCs' results when one invocation 500s", async () => {
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (first) {
          first = false;
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ok("x", 2, 20) };
      }),
    );

    const n = enabledSources().length;
    const s = await fanoutSync(ORIGIN, SECRET);
    expect(s.results).toHaveLength(n);
    expect(s.failed).toBe(1);
    expect(s.ingested).toBe(2 * (n - 1)); // the rest still landed
    expect(s.results.some((r) => r.errors.some((e) => /HTTP 500/.test(e)))).toBe(true);
  });

  it("survives a network-level rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );

    const s = await fanoutSync(ORIGIN, SECRET);
    expect(s.amcs).toBe(enabledSources().length);
    expect(s.failed).toBe(s.amcs);
    expect(s.results[0].errors[0]).toMatch(/ECONNRESET/);
  });

  it("rebuilds signals once, after every AMC has landed", async () => {
    // Per-AMC invocations skip recomputation, and a month's signals depend on
    // the prior month being complete — so this must run exactly once, at the end.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ok("x") })),
    );

    await fanoutSync(ORIGIN, SECRET);
    expect(recomputeAllSignals).toHaveBeenCalledTimes(1);
  });

  it("still rebuilds signals when some AMCs failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );

    await fanoutSync(ORIGIN, SECRET);
    expect(recomputeAllSignals).toHaveBeenCalledTimes(1);
  });
});
