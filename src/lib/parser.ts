// Run the holdings extractor and normalize its JSON.
// extract.py emits either a single fund object, or {amc, funds:[...]} for a
// consolidated multi-scheme workbook. We normalize both to ParsedFund[].
//
// Two transports, because a Node function has no Python runtime:
//
//  - **HTTP** (production): POST to the Python Vercel Function at
//    `api/parse.py`, which downloads the stored blob and parses it. This is
//    what removes the need for a container host.
//  - **subprocess** (local dev, tests): spawn `parser/extract.py` directly.
//    Used whenever PARSER_URL is unset, so `next dev` works without running
//    the Python function locally.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ParsedFund } from "@/lib/ingest";
import { isRemote, materialize } from "@/lib/storage";

const execFileAsync = promisify(execFile);

interface MultiResult {
  amc: string;
  funds: Omit<ParsedFund, "amc">[];
}

/**
 * Absolute URL of the Python parse function, or null to use a subprocess.
 *
 * Mirrors selfOrigin(): VERCEL_URL so a preview parses against its own function,
 * but the production URL in production, because deployment protection 302s the
 * VERCEL_URL host to an SSO page and the parser would receive HTML.
 */
function parserUrl(): string | null {
  const explicit = process.env.PARSER_URL;
  if (explicit) return explicit;
  const host =
    (process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : undefined) || process.env.VERCEL_URL;
  return host ? `https://${host}/api/parse` : null;
}

async function runViaHttp(
  url: string,
  storedPath: string,
  filename: string,
  fundNameHint?: string,
  amcHint?: string,
): Promise<unknown> {
  const secret = process.env.PARSER_SECRET;
  if (!secret) throw new Error("PARSER_SECRET is not set");
  if (!isRemote(storedPath)) {
    throw new Error(
      `parser service needs an https blob reference, got local path ${storedPath}`,
    );
  }

  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-parser-secret": secret,
      // Preview deployments are behind Vercel Authentication; without this a
      // function calling its own sibling gets a 401 login page.
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    },
    body: JSON.stringify({
      url: storedPath,
      filename,
      fund_name_hint: fundNameHint ?? "",
      amc_hint: amcHint ?? "",
    }),
  });

  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(`parser service: ${detail}`);
  }
  return parsed;
}

async function runViaSubprocess(
  storedPath: string,
  fundNameHint?: string,
  amcHint?: string,
  filename?: string,
): Promise<unknown> {
  const python = process.env.PYTHON_BIN || "python3";
  const script = path.join(process.cwd(), "parser", "extract.py");

  // extract.py opens a real file, so blob-backed refs need a local temp copy.
  const file = await materialize(storedPath, filename);
  let stdout: string;
  try {
    const args = [script, file.path];
    if (fundNameHint || amcHint) args.push(fundNameHint ?? "");
    if (amcHint) args.push(amcHint);
    ({ stdout } = await execFileAsync(python, args, {
      maxBuffer: 128 * 1024 * 1024,
    }).catch((err: { stdout?: string; stderr?: string; message: string }) => {
      if (err.stdout) return { stdout: err.stdout };
      throw new Error(err.stderr || err.message);
    }));
  } finally {
    await file.cleanup();
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Parser produced non-JSON output: ${stdout.slice(0, 200)}`);
  }
}

export async function runParser(
  storedPath: string,
  fundNameHint?: string,
  amcHint?: string,
  filename?: string,
): Promise<ParsedFund[]> {
  const url = parserUrl();
  const name = filename ?? path.basename(storedPath);

  const parsed = url
    ? await runViaHttp(url, storedPath, name, fundNameHint, amcHint)
    : await runViaSubprocess(storedPath, fundNameHint, amcHint, name);

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
