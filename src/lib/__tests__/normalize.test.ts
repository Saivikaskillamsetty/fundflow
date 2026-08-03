// Stock identity decides whether two funds holding the same company aggregate
// into one conviction score or split into two. Splitting is the quiet failure:
// nothing errors, the stock just looks half as widely held as it is.
import { describe, expect, it } from "vitest";
import { nameKey, normalizeName, stockKeyOf } from "@/lib/normalize";

describe("normalizeName", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeName("  Reliance   Industries Ltd  ")).toBe("Reliance Industries Ltd");
  });

  it("strips fact-sheet footnote markers", () => {
    expect(normalizeName("Infosys Ltd*")).toBe("Infosys Ltd");
    expect(normalizeName("ITC Ltd##")).toBe("ITC Ltd");
  });

  it("resolves known short forms to their full name", () => {
    expect(normalizeName("TCS")).toBe("Tata Consultancy Services Ltd");
    expect(normalizeName("L&T")).toBe("Larsen & Toubro Ltd");
    expect(normalizeName("Reliance Industries")).toBe("Reliance Industries Ltd");
  });

  it("handles empty input without throwing", () => {
    expect(normalizeName("")).toBe("");
  });
});

describe("nameKey", () => {
  it("matches the same company across suffix styles", () => {
    expect(nameKey("Infosys Limited")).toBe(nameKey("Infosys Ltd"));
    expect(nameKey("Infosys Ltd.")).toBe(nameKey("Infosys"));
  });

  it("ignores punctuation differences", () => {
    expect(nameKey("Larsen & Toubro Ltd")).toBe(nameKey("Larsen and Toubro"));
  });

  it("keeps genuinely different companies apart", () => {
    expect(nameKey("HDFC Bank Ltd")).not.toBe(nameKey("HDFC Life Insurance Ltd"));
    expect(nameKey("Tata Motors Ltd")).not.toBe(nameKey("Tata Steel Ltd"));
  });
});

describe("stockKeyOf", () => {
  it("prefers ISIN, so a renamed company still resolves to one stock", () => {
    expect(stockKeyOf({ stock_name: "Infosys Ltd", isin: "INE009A01021" })).toBe(
      stockKeyOf({ stock_name: "Infosys Limited", isin: "INE009A01021" }),
    );
  });

  it("falls back to the canonical name when ISIN is absent", () => {
    expect(stockKeyOf({ stock_name: "TCS" })).toBe("name:Tata Consultancy Services Ltd");
  });

  it("treats blank and whitespace-only ISINs as absent", () => {
    expect(stockKeyOf({ stock_name: "Infosys Ltd", isin: "   " })).toBe(
      stockKeyOf({ stock_name: "Infosys Ltd", isin: null }),
    );
  });
});
