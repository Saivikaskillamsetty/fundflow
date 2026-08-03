import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { expandArchive, isZip } from "@/lib/archive";

const zip = (files: Record<string, string>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
    ),
  );

describe("isZip", () => {
  it("keys off the extension, not magic bytes", () => {
    expect(isZip("bundle.zip")).toBe(true);
    expect(isZip("BUNDLE.ZIP")).toBe(true);
    // A .xlsx is itself a zip container. Detecting by magic bytes would shred
    // every workbook into its internal XML parts.
    expect(isZip("portfolio.xlsx")).toBe(false);
    expect(isZip("factsheet.pdf")).toBe(false);
  });
});

describe("expandArchive", () => {
  it("passes non-archives through untouched", () => {
    const body = Buffer.from("not really a workbook");
    expect(expandArchive("portfolio.xlsx", body)).toEqual([
      { filename: "portfolio.xlsx", body },
    ]);
  });

  it("does not expand an xlsx even though it is a valid zip", () => {
    const workbook = zip({ "xl/workbook.xml": "<workbook/>" });
    const out = expandArchive("portfolio.xlsx", workbook);
    expect(out).toHaveLength(1);
    expect(out[0].filename).toBe("portfolio.xlsx");
    expect(out[0].body).toBe(workbook);
  });

  it("returns each parseable member of a bundle", () => {
    const out = expandArchive(
      "monthly.zip",
      zip({ "a.xlsx": "A", "b.pdf": "B", "c.xls": "C" }),
    );
    expect(out.map((e) => e.filename).sort()).toEqual(["a.xlsx", "b.pdf", "c.xls"]);
    expect(out.find((e) => e.filename === "a.xlsx")!.body.toString()).toBe("A");
  });

  it("flattens nested paths to a basename", () => {
    const out = expandArchive(
      "monthly.zip",
      zip({ "June 2026/schemes/portfolio.xlsx": "X" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].filename).toBe("portfolio.xlsx");
  });

  it("drops macOS resource forks and dotfiles", () => {
    const out = expandArchive(
      "monthly.zip",
      zip({
        "__MACOSX/._portfolio.xlsx": "junk",
        ".DS_Store": "junk",
        "portfolio.xlsx": "real",
      }),
    );
    expect(out.map((e) => e.filename)).toEqual(["portfolio.xlsx"]);
  });

  it("throws naming what it found when no member is parseable", () => {
    expect(() =>
      expandArchive("monthly.zip", zip({ "readme.txt": "hi", "notes.md": "yo" })),
    ).toThrow(/no \.pdf\/\.xlsx\/\.xls member \(found: readme\.txt/);
  });

  it("throws a filename-tagged error on a corrupt archive", () => {
    expect(() => expandArchive("broken.zip", Buffer.from("PK\x03\x04garbage"))).toThrow(
      /could not read zip broken\.zip/,
    );
  });
});
