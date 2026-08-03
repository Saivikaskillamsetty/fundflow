// fuzzyMonthKey decides which months get ingested. When it returns 0 the file
// is dropped silently, and when it returns the wrong month the holdings land
// under the wrong reporting period — so these cases are drawn from real
// filenames observed across the enabled AMCs.
import { describe, expect, it } from "vitest";
import { fuzzyMonthKey } from "@/lib/fetcher/amcs";

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
  ])("dates %s as %i", (filename, expected) => {
    expect(fuzzyMonthKey(filename)).toBe(expected);
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
