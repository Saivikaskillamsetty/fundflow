// Run the Python holdings extractor as a subprocess and parse its JSON.
// extract.py emits either a single fund object, or {amc, funds:[...]} for a
// consolidated multi-scheme workbook. We normalize both to ParsedFund[].
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ParsedFund } from "@/lib/ingest";
import { materialize } from "@/lib/storage";

const execFileAsync = promisify(execFile);

interface MultiResult {
  amc: string;
  funds: Omit<ParsedFund, "amc">[];
}

export async function runParser(
  filePath: string,
  fundNameHint?: string,
  amcHint?: string,
): Promise<ParsedFund[]> {
  const python = process.env.PYTHON_BIN || "python3";
  const script = path.join(process.cwd(), "parser", "extract.py");

  // extract.py opens a real file, so blob-backed refs need a local temp copy.
  const file = await materialize(filePath);
  let stdout: string;
  try {
    const args = [script, file.path];
    if (fundNameHint || amcHint) args.push(fundNameHint ?? "");
    if (amcHint) args.push(amcHint);
    ({ stdout } = await execFileAsync(
      python,
      args,
      { maxBuffer: 128 * 1024 * 1024 },
    ).catch((err: { stdout?: string; stderr?: string; message: string }) => {
      if (err.stdout) return { stdout: err.stdout };
      throw new Error(err.stderr || err.message);
    }));
  } finally {
    await file.cleanup();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Parser produced non-JSON output: ${stdout.slice(0, 200)}`);
  }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    throw new Error(String((parsed as { error: string }).error));
  }

  // Multi-scheme workbook → fan out, stamping the shared AMC onto each fund.
  if (parsed && typeof parsed === "object" && "funds" in parsed) {
    const m = parsed as MultiResult;
    return m.funds.map((f) => ({ ...f, amc: amcHint || m.amc }) as ParsedFund);
  }
  const single = parsed as ParsedFund;
  if (amcHint) single.amc = amcHint;
  return [single];
}
