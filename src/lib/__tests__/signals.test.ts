import { describe, expect, it } from "vitest";
import { classify, nextMonthOf, prevMonthOf } from "@/lib/signals";

describe("classify", () => {
  const THRESHOLD = 0.1; // SIGNAL_THRESHOLD default

  it("calls a meaningful weight increase a BUY", () => {
    expect(classify(0.5)).toBe("BUY");
    expect(classify(THRESHOLD + 0.001)).toBe("BUY");
  });

  it("calls a meaningful weight decrease a SELL", () => {
    expect(classify(-0.5)).toBe("SELL");
    expect(classify(-THRESHOLD - 0.001)).toBe("SELL");
  });

  it("treats movement inside the threshold as HOLD", () => {
    expect(classify(0)).toBe("HOLD");
    expect(classify(0.05)).toBe("HOLD");
    expect(classify(-0.05)).toBe("HOLD");
  });

  it("is inclusive at the boundary — exactly the threshold is not a signal", () => {
    expect(classify(THRESHOLD)).toBe("HOLD");
    expect(classify(-THRESHOLD)).toBe("HOLD");
  });
});

describe("month arithmetic", () => {
  it("steps back and forward within a year", () => {
    expect(prevMonthOf("2026-06")).toBe("2026-05");
    expect(nextMonthOf("2026-06")).toBe("2026-07");
  });

  it("crosses year boundaries", () => {
    expect(prevMonthOf("2026-01")).toBe("2025-12");
    expect(nextMonthOf("2025-12")).toBe("2026-01");
  });

  it("keeps the zero-padded YYYY-MM shape the schema stores", () => {
    expect(prevMonthOf("2026-10")).toBe("2026-09");
    expect(nextMonthOf("2026-09")).toBe("2026-10");
  });

  it("round-trips", () => {
    for (const m of ["2025-01", "2025-11", "2026-03", "2026-12"]) {
      expect(nextMonthOf(prevMonthOf(m))).toBe(m);
    }
  });
});
