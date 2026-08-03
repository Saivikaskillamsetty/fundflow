// HDFC is the one AMC whose listing page is unreachable from a datacenter IP
// (its WAF 403s Vercel), so production falls back to constructing file URLs.
// Constructed URLs have no listing to validate against — a wrong month or a
// wrong date format just 403s and the month silently goes missing — so the
// shape is pinned here against URLs observed live.
import { describe, expect, it } from "vitest";
import { hdfcConstructed, newestPublishedMonth } from "@/lib/fetcher/amcs";

describe("newestPublishedMonth", () => {
  it("uses last month once the publishing window has passed", () => {
    // 12 Aug → July data is up.
    expect(newestPublishedMonth(new Date("2026-08-12T00:00:00Z"))).toEqual({
      y: 2026,
      m: 7,
    });
    expect(newestPublishedMonth(new Date("2026-08-28T00:00:00Z"))).toEqual({
      y: 2026,
      m: 7,
    });
  });

  it("steps back two months before the window, when last month is not up yet", () => {
    // 3 Aug → July is not published; June is the newest that exists.
    expect(newestPublishedMonth(new Date("2026-08-03T00:00:00Z"))).toEqual({
      y: 2026,
      m: 6,
    });
  });

  it("crosses year boundaries", () => {
    expect(newestPublishedMonth(new Date("2026-01-05T00:00:00Z"))).toEqual({
      y: 2025,
      m: 11,
    });
    expect(newestPublishedMonth(new Date("2026-01-20T00:00:00Z"))).toEqual({
      y: 2025,
      m: 12,
    });
  });
});

describe("hdfcConstructed", () => {
  const items = hdfcConstructed(2, new Date("2026-08-12T00:00:00Z"));

  it("covers every pinned scheme for each requested month", () => {
    expect(items.length).toBeGreaterThan(0);
    expect(items.length % 2).toBe(0); // same scheme count in both months
  });

  it("builds the exact URL shape HDFC publishes", () => {
    // Verified against a real link: the folder is the month AFTER the data
    // month, and the filename carries the data month's last day.
    const june = hdfcConstructed(1, new Date("2026-07-15T00:00:00Z")).find((i) =>
      i.filename.includes("HDFC Value Fund"),
    );
    expect(june?.url).toBe(
      "https://files.hdfcfund.com/s3fs-public/2026-07/Monthly%20HDFC%20Value%20Fund%20-%2030%20June%202026.xlsx",
    );
  });

  it("uses the last day of the data month, not a fixed 30", () => {
    const jan = hdfcConstructed(1, new Date("2026-02-20T00:00:00Z")).find((i) =>
      i.filename.includes("HDFC Value Fund"),
    );
    expect(jan?.url).toContain("/2026-02/");
    expect(jan?.url).toContain("31%20January%202026");
  });

  it("carries a fund-name hint so the parser does not have to guess", () => {
    expect(items.every((i) => (i.fundNameHint ?? "").startsWith("HDFC"))).toBe(true);
  });

  it("returns months newest-first", () => {
    const two = hdfcConstructed(2, new Date("2026-08-12T00:00:00Z"));
    expect(two[0].url).toContain("/2026-08/"); // July data
    expect(two[two.length - 1].url).toContain("/2026-07/"); // June data
  });
});
