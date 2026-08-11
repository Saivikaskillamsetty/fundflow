import { describe, expect, it } from "vitest";
import { composeReport } from "@/lib/report-email";
import type { FanoutSummary } from "@/lib/fanout";

const summary: FanoutSummary = {
  amcs: 2,
  ingested: 30,
  holdings: 1900,
  failed: 1,
  results: [
    { amc: "HDFC Mutual Fund", ingested: 22, holdings: 1400, failed: 0, errors: [] },
    {
      amc: "Motilal Oswal Mutual Fund",
      ingested: 8,
      holdings: 500,
      failed: 1,
      errors: ["PortfolioHolding.xlsx: download failed 404"],
    },
  ],
};

const newestByAmc = [
  { amc: "HDFC Mutual Fund", newest: "2026-07", funds: 22 },
  { amc: "Motilal Oswal Mutual Fund", newest: "2026-05", funds: 8 },
];

const signalMix = [
  { month: "2026-06", signal: "BUY", count: 900 },
  { month: "2026-07", signal: "BUY", count: 800 },
  { month: "2026-07", signal: "HOLD", count: 2600 },
  { month: "2026-07", signal: "SELL", count: 810 },
];

describe("composeReport", () => {
  it("titles the subject with the newest month across AMCs", () => {
    const { subject } = composeReport(summary, newestByAmc, signalMix);
    expect(subject).toBe("FundFlow monthly sync — 2026-07 results");
  });

  it("reports per-AMC months, newest-month signals, and errors", () => {
    const { text } = composeReport(summary, newestByAmc, signalMix);
    expect(text).toContain("HDFC Mutual Fund: 2026-07 (22 funds)");
    expect(text).toContain("Motilal Oswal Mutual Fund: 2026-05 (8 funds)");
    expect(text).toContain("Signals for 2026-07: BUY 800 / HOLD 2600 / SELL 810");
    expect(text).toContain("download failed 404");
    expect(text).toContain("30 funds ingested, 1900 holdings, 1 failed across 2 AMCs");
  });

  it("says so plainly when there are no errors", () => {
    const clean: FanoutSummary = {
      ...summary,
      failed: 0,
      results: summary.results.map((r) => ({ ...r, failed: 0, errors: [] })),
    };
    const { text } = composeReport(clean, newestByAmc, signalMix);
    expect(text).toContain("No errors.");
  });

  it("handles an AMC with no ingested data yet", () => {
    const { subject, text } = composeReport(
      summary,
      [{ amc: "New AMC", newest: null, funds: 0 }],
      [],
    );
    expect(subject).toBe("FundFlow monthly sync — unknown results");
    expect(text).toContain("New AMC: none (0 funds)");
  });
});

// Eleven runs a month must not mean eleven emails, and a quiet run should still
// say plainly that nothing moved rather than looking identical to a busy one.
describe("composeReport — what changed", () => {
  it("lists the AMCs that advanced", () => {
    const { text } = composeReport(summary, newestByAmc, signalMix, [
      "HDFC Mutual Fund: 2026-06 → 2026-07",
      "Tata Mutual Fund: none → 2026-06",
    ]);
    expect(text).toContain("New data this run:");
    expect(text).toContain("HDFC Mutual Fund: 2026-06 → 2026-07");
    expect(text).toContain("Tata Mutual Fund: none → 2026-06");
  });

  it("says so when nothing advanced", () => {
    const { text } = composeReport(summary, newestByAmc, signalMix, []);
    expect(text).toContain("No AMC advanced to a newer month this run.");
  });
});
