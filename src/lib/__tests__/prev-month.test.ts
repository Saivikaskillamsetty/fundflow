// getDashboard derives prevMonth from the months that actually have data
// rather than by calendar arithmetic, because the dashboard banner keys off
// null to say "earliest month — everything reads as new". This pins that rule
// without standing up a database.
import { describe, expect, it } from "vitest";

/** Mirrors the derivation in getDashboard: `months` is newest-first. */
const prevMonthOfSeries = (months: string[], month: string | null) =>
  month ? (months[months.indexOf(month) + 1] ?? null) : null;

const MONTHS = ["2026-06", "2026-05", "2026-04", "2026-03"];

describe("dashboard prevMonth", () => {
  it("is the next entry in the newest-first series", () => {
    expect(prevMonthOfSeries(MONTHS, "2026-06")).toBe("2026-05");
    expect(prevMonthOfSeries(MONTHS, "2026-04")).toBe("2026-03");
  });

  it("is null for the earliest month, which is what the banner keys off", () => {
    expect(prevMonthOfSeries(MONTHS, "2026-03")).toBeNull();
  });

  it("is null when there is no data at all", () => {
    expect(prevMonthOfSeries([], null)).toBeNull();
  });

  it("skips a gap instead of naming a month with no data", () => {
    // May never landed; June's comparison basis is April, not May.
    const gapped = ["2026-06", "2026-04", "2026-03"];
    expect(prevMonthOfSeries(gapped, "2026-06")).toBe("2026-04");
  });
});
