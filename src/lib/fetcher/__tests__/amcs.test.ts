// fuzzyMonthKey decides which months get ingested. When it returns 0 the file
// is dropped silently, and when it returns the wrong month the holdings land
// under the wrong reporting period — so these cases are drawn from real
// filenames observed across the enabled AMCs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AMC_SOURCES, fuzzyMonthKey } from "@/lib/fetcher/amcs";

describe("fuzzyMonthKey", () => {
  it.each([
    // Aditya Birla SL — the least consistent publisher of the set.
    ["monthly-portfolio-30-june-2026.zip", 202606],
    ["31052026_abslmf_monthly-portfolio.zip", 202605],
    ["monthly-disclosure-april-30-2026.zip", 202604],
    ["monthly-portfolio-mar-2026.zip", 202603],
    ["sebi_monthly_portfolio-28-feb-2026.zip", 202602],
    ["sebi_monthly_portfolio-31-jan-2026.zip", 202601],
    // Other AMC shapes.
    ["Monthly-Portfolio-31st-May-2026.xlsx", 202605],
    ["Monthly_Portfolio_31.03.2026.xlsx", 202603],
    ["portfolio-30042026.xlsx", 202604],
    ["Monthly Portfolio May 31, 2026.xlsx", 202605],
    ["scheme-portfolio-May26.xlsx", 202605],
    ["disclosure_Nov_2025.xlsx", 202511],
    ["portfolio-sept-2025.xlsx", 202509],
    // Axis: all-numeric with a two-digit year, separator varying by host.
    ["Monthly_Portfolio_31_05_26.xlsx", 202605],
    ["Monthly Portfolio-30 04 26.xlsx", 202604],
    ["Monthly Portfolio-28 02 26.xlsx", 202602],
    // Motilal: a re-upload counter glued onto the year.
    ["Scheme Portfolio Details June 20261.xlsx", 202606],
  ])("dates %s as %i", (filename, expected) => {
    expect(fuzzyMonthKey(filename)).toBe(expected);
  });

  it("does not read a month out of a long digit run", () => {
    // Edelweiss appends a DDMMYYYYHHMMSS publish stamp; the real date is the
    // one spelled out, not any two digits inside the stamp.
    expect(
      fuzzyMonthKey("EDEL_Portfolio_Monthly_Notes_30Jun2026_10072026123257.xlsx"),
    ).toBe(202606);
  });

  it("URL-decodes before matching", () => {
    expect(fuzzyMonthKey("FW_%20UTI_MF_Scheme_portfolios-28.02.2026.zip")).toBe(202602);
  });

  it("returns 0 rather than guessing when there is no date", () => {
    expect(fuzzyMonthKey("monthly-portfolio-latest.xlsx")).toBe(0);
    expect(fuzzyMonthKey("factsheet.pdf")).toBe(0);
  });

  it("rejects out-of-range years and months", () => {
    expect(fuzzyMonthKey("portfolio-31-13-2026.xlsx")).toBe(0);
    expect(fuzzyMonthKey("portfolio-31-05-1999.xlsx")).toBe(0);
  });
});

// A dead link must not consume the month budget. AdvisorKhoj lists Motilal's
// two newest months as 404s while older months resolve, so a naive "newest N"
// returns nothing ingestible at all.
describe("advisorKhoj discovery skips links that are gone", () => {
  const LISTING = /advisorkhoj\.com/;
  const HOST = "https://www.motilaloswalmf.com/x";

  function mockSite(dead: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (LISTING.test(url)) {
          const html = [
            `${HOST}/Scheme Portfolio Details June 2026.xlsx`,
            `${HOST}/PortfolioHolding_May 31, 2026.xlsx`,
            `${HOST}/Motilal Portfolio 30 April 2026 - Final.xlsx`,
            `${HOST}/month-end-portfolio-march-2026.xlsx`,
          ]
            .map((h) => `<a href="${h}">f</a>`)
            .join("");
          return { ok: true, status: 200, text: async () => html };
        }
        const gone = dead.some((d) => decodeURIComponent(url).includes(d));
        // Some CDNs 404 every HEAD while serving GET fine, so a gone verdict is
        // only trusted once a ranged GET agrees.
        if (init?.method === "HEAD") return { ok: false, status: 404 };
        return { ok: !gone, status: gone ? 404 : 206 };
      }),
    );
  }

  const motilal = () =>
    AMC_SOURCES.find((s) => s.amc === "Motilal Oswal Mutual Fund")!;

  afterEach(() => vi.unstubAllGlobals());

  it("walks back past dead months to reach live ones", async () => {
    mockSite(["June 2026", "May 31, 2026"]);
    const items = await motilal().discover(2);
    expect(items.map((i) => i.filename)).toEqual([
      "Motilal Portfolio 30 April 2026 - Final.xlsx",
      "month-end-portfolio-march-2026.xlsx",
    ]);
  });

  it("returns the newest months untouched when nothing is dead", async () => {
    mockSite([]);
    const items = await motilal().discover(2);
    expect(items.map((i) => i.filename)).toEqual([
      "Scheme Portfolio Details June 2026.xlsx",
      "PortfolioHolding_May 31, 2026.xlsx",
    ]);
  });

  it("yields nothing rather than reaching for stale years", async () => {
    mockSite(["June 2026", "May 31, 2026", "April 2026", "march-2026"]);
    expect(await motilal().discover(2)).toEqual([]);
  });
});
