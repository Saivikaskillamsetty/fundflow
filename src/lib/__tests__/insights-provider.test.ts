// LLM_PROVIDER defaults to a local Ollama. Deployed, that points at a localhost
// which cannot exist in a function, and the bare fetch rejection reached the UI
// as "fetch failed" — naming neither the host nor the unset variable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/conviction", () => ({
  getStockDetail: async () => ({
    stock: { id: 1, canonicalName: "Test Ltd", sector: "IT", isin: "INE000A01001" },
    agg: { fundsBuying: 1, fundsSelling: 0, fundsHolding: 2, netDeltaPct: 1.2, conviction: 50 },
    rows: [{ fund: "A Fund", amc: "A AMC", prevPct: 1, currPct: 2, signal: "BUY" }],
    month: "2026-06",
  }),
}));
vi.mock("@/db", () => ({
  db: { insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }) },
  schema: {},
}));

const ORIGINAL = { ...process.env };

async function generate() {
  vi.resetModules();
  const { generateInsight } = await import("@/lib/insights");
  return generateInsight(1);
}

beforeEach(() => {
  // Every provider path here should fail before or without a usable network.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("provider misconfiguration", () => {
  it("names the unset variable when deployed without a provider", async () => {
    process.env.VERCEL = "1";
    delete process.env.LLM_PROVIDER;
    await expect(generate()).rejects.toThrow(/LLM_PROVIDER is unset/);
  });

  it("points at the unreachable host when running locally", async () => {
    delete process.env.VERCEL;
    delete process.env.LLM_PROVIDER;
    process.env.OLLAMA_URL = "http://localhost:11434";
    await expect(generate()).rejects.toThrow(
      /Cannot reach Ollama at http:\/\/localhost:11434/,
    );
  });

  it("still asks for the key when groq is selected without one", async () => {
    process.env.VERCEL = "1";
    process.env.LLM_PROVIDER = "groq";
    delete process.env.GROQ_API_KEY;
    await expect(generate()).rejects.toThrow(/GROQ_API_KEY not set/);
  });
});
