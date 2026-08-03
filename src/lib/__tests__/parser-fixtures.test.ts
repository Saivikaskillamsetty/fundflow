// Parser regression against the fixture corpus.
//
// extract.py finds the SEBI equity table by matching header synonyms. When a
// synonym stops matching, it does not crash — it silently returns fewer rows,
// and fewer rows produce confident but wrong BUY/SELL signals downstream. That
// is the failure this suite exists to catch, so the assertions are on exact
// holdings counts and per-ISIN weights, not just "parsed without error".
//
// dataset.json is the ground truth gen_fixtures.py rendered the PDFs from.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const FIXTURES = path.join(process.cwd(), "parser", "fixtures");
const SCRIPT = path.join(process.cwd(), "parser", "extract.py");
const PYTHON = process.env.PYTHON_BIN || path.join(process.cwd(), "parser", ".venv", "bin", "python");

interface Holding {
  stock_name: string;
  isin: string;
  sector: string;
  holding_pct: number;
  market_value: number;
  shares_held: number;
}

interface Expected {
  amc: string;
  fund_name: string;
  report_month: string;
  source_file: string;
  holdings: Holding[];
}

const dataset: Expected[] = JSON.parse(
  readFileSync(path.join(FIXTURES, "dataset.json"), "utf8"),
);

async function runParser(file: string): Promise<{ amc: string; report_month: string; holdings: Holding[] }> {
  const { stdout } = await execFileAsync(PYTHON, [SCRIPT, file], {
    maxBuffer: 128 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

// The venv is created by setup, not checked in; skip rather than fail red on a
// machine that has not run it.
const hasPython = existsSync(PYTHON);

describe.skipIf(!hasPython)("extract.py against fixture corpus", () => {
  it("has a fixture for every dataset entry", () => {
    expect(dataset.length).toBeGreaterThan(0);
    for (const entry of dataset) {
      expect(existsSync(path.join(FIXTURES, entry.source_file))).toBe(true);
    }
  });

  for (const entry of dataset) {
    describe(entry.source_file, () => {
      it("extracts every holding with correct identity and weight", async () => {
        const got = await runParser(path.join(FIXTURES, entry.source_file));

        expect(got.amc).toBe(entry.amc);
        expect(got.report_month).toBe(entry.report_month);

        // The count assertion is the point: a dropped row is the silent bug.
        expect(got.holdings).toHaveLength(entry.holdings.length);

        const byIsin = new Map(got.holdings.map((h) => [h.isin, h]));
        for (const want of entry.holdings) {
          const actual = byIsin.get(want.isin);
          expect(actual, `missing ISIN ${want.isin} (${want.stock_name})`).toBeDefined();
          expect(actual!.holding_pct).toBeCloseTo(want.holding_pct, 2);
          expect(actual!.shares_held).toBe(want.shares_held);
        }
      });

      it("returns weights that sum to a plausible equity allocation", async () => {
        const got = await runParser(path.join(FIXTURES, entry.source_file));
        const total = got.holdings.reduce((s, h) => s + h.holding_pct, 0);
        const expected = entry.holdings.reduce((s, h) => s + h.holding_pct, 0);
        // Equity weights can top 100% of net assets (a fund running negative
        // cash does it, and one fixture sums to 101.4), so the ceiling is
        // loose. The real guard is matching ground truth: a short total means
        // rows went missing.
        expect(total).toBeCloseTo(expected, 1);
        expect(total).toBeGreaterThan(50);
        expect(total).toBeLessThan(110);
      });
    });
  }
});
