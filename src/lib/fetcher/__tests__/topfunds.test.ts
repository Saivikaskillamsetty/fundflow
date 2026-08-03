// Curation is the last filter before ingestion. Letting a debt or index scheme
// through pollutes cross-fund conviction with holdings that are not equity
// convictions at all, so each AMC's allowlist is asserted in both directions.
import { describe, expect, it } from "vitest";
import { isTopFund } from "@/lib/fetcher/topfunds";

const ABSL = "Aditya Birla Sun Life Mutual Fund";

describe("isTopFund", () => {
  it("keeps flagship equity schemes", () => {
    expect(isTopFund(ABSL, "ADITYA BIRLA SUN LIFE FLEXI CAP FUND")).toBe(true);
    expect(isTopFund(ABSL, "ADITYA BIRLA SUN LIFE SMALL CAP FUND")).toBe(true);
    expect(isTopFund(ABSL, "ADITYA BIRLA SUN LIFE ELSS TAX SAVER FUND")).toBe(true);
    expect(isTopFund("HDFC Mutual Fund", "HDFC Flexi Cap Fund")).toBe(true);
    expect(isTopFund("Axis Mutual Fund", "Axis Bluechip Fund")).toBe(true);
  });

  it("drops debt, liquid and money-market schemes", () => {
    for (const name of [
      "ADITYA BIRLA SUN LIFE LIQUID FUND",
      "ADITYA BIRLA SUN LIFE CORPORATE BOND FUND",
      "ADITYA BIRLA SUN LIFE LONG DURATION FUND",
      "ADITYA BIRLA SUN LIFE MONEY MANAGER FUND",
      "ADITYA BIRLA SUN LIFE CREDIT RISK FUND",
      "ADITYA BIRLA SUN LIFE GOVERNMENT SECURITIES FUND",
    ]) {
      expect(isTopFund(ABSL, name), name).toBe(false);
    }
  });

  it("drops passive products even when the name also matches an equity rule", () => {
    // "MIDCAP" and "INFRASTRUCTURE" would otherwise qualify these.
    expect(isTopFund(ABSL, "ADITYA BIRLA SUN LIFE NIFTY MIDCAP 150 INDEX FUND")).toBe(false);
    expect(isTopFund(ABSL, "ADITYA BIRLA SUN LIFE BSE INDIA INFRASTRUCTURE INDEX FUND")).toBe(false);
    expect(isTopFund(ABSL, "An open ended exchange traded fund tracking Nifty Bank")).toBe(false);
  });

  it("drops the workbook's unnamed internal scheme codes", () => {
    expect(isTopFund(ABSL, "Aditya Birla Sun Life Mutual Fund BSLBBYW")).toBe(false);
  });

  it("does not let ABSL's own Quant scheme fall through to the Quant AMC rule", () => {
    // TOP_FUNDS is matched on the AMC name in list order, so an ABSL rule must
    // exist ahead of any rule whose pattern could also describe its schemes.
    expect(isTopFund(ABSL, "ADITYA BIRLA SUN LIFE QUANT FUND")).toBe(true);
    expect(isTopFund(ABSL, "ADITYA BIRLA SUN LIFE SHORT TERM FUND")).toBe(false);
  });

  it("keeps everything for an AMC with no curation rule", () => {
    expect(isTopFund("Some New Mutual Fund", "Some New Debt Fund")).toBe(true);
  });
});
