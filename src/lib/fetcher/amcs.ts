// Per-AMC monthly-portfolio sources. Each AMC exposes data differently, so
// each provides a `discover(months)` strategy returning the files to download.
//
// Everything here runs on plain HTTP. Pages that look like they need a browser
// were doing header-based bot checks, not JS rendering — see fetcher/http.ts.
// Nippon's own download page is genuinely JS-rendered, so it is sourced from
// AdvisorKhoj instead. SBI/ICICI/Kotak remain disabled: their full portfolios
// are behind WAF-protected SPAs with nothing on AdvisorKhoj either.
import { discoverLinks, isLikelyLive, UA } from "@/lib/fetcher/http";
import { keepTopFundFile } from "@/lib/fetcher/topfunds";

export interface FetchItem {
  url: string;
  filename: string;
  fundNameHint?: string; // overrides parser's fund-name guess
}

export interface AmcSource {
  amc: string;
  enabled: boolean;
  months: number; // how many recent months to fetch
  discover: (months: number) => Promise<FetchItem[]>;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Parse a date embedded in a string → {y,m,d} or null. */
function parseDate(s: string): { y: number; m: number; d: number } | null {
  const m = s.match(/(\d{1,2})[-_ ]+([A-Za-z]{3,9})[-_ ]+(\d{2,4})/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return { y, m: mon, d: Number(m[1]) };
}

const filenameOf = (url: string) =>
  decodeURIComponent(url.split("/").pop() || "file");

// ---- HDFC: one file per scheme per month, predictable folder pattern ------
// Current-month links live on the page; prior months are reached by rewriting
// the /YYYY-MM/ folder + the "DD Month YYYY" date in each filename.
//
// hdfcfund.com's WAF rejects datacenter IPs — the listing page returns 200 from
// a residential connection and 403 from Vercel — so page discovery cannot be
// relied on in production. The file CDN (files.hdfcfund.com) is not protected
// and the URLs are fully deterministic, so when the page is unreachable we
// construct them from the pinned scheme list below.
//
// The page is still tried first: it is the only way a newly launched scheme
// gets picked up. HDFC_SCHEMES is a fallback, and will drift as HDFC adds or
// renames funds.
const HDFC_SCHEMES = [
  "HDFC Balanced Advantage Fund",
  "HDFC Business Cycle Fund",
  "HDFC Defence Fund",
  "HDFC Dividend Yield Fund",
  "HDFC ELSS Tax saver",
  "HDFC Flexi Cap Fund",
  "HDFC Focused Fund",
  "HDFC Housing Opportunities Fund",
  "HDFC Hybrid Equity Fund",
  "HDFC Infrastructure Fund",
  "HDFC Innovation Fund",
  "HDFC Large Cap Fund",
  "HDFC Large and Mid Cap Fund",
  "HDFC MNC Fund",
  "HDFC Mid Cap Fund",
  "HDFC Multi Cap Fund",
  "HDFC Small Cap Fund",
  "HDFC Technology Fund",
  "HDFC Transportation and Logistics Fund",
  "HDFC Value Fund",
];

/** Build the canonical HDFC URL for one scheme and one data month. */
function hdfcUrl(scheme: string, y: number, m: number): string {
  // Folder is the month AFTER the data month (June data → /2026-07/).
  const folderDate = new Date(Date.UTC(y, m, 1));
  const folder = `${folderDate.getUTCFullYear()}-${String(
    folderDate.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
  const dated = `${lastDay(y, m)} ${MONTH_NAMES[m]} ${y}`;
  const name = `Monthly ${scheme} - ${dated}.xlsx`;
  return `https://files.hdfcfund.com/s3fs-public/${folder}/${encodeURIComponent(name).replace(/%2F/g, "/")}`;
}

/**
 * Newest data month that is plausibly published.
 *
 * SEBI gives AMCs ~10 days after month-end, so before roughly the 12th the
 * previous month is not up yet and requesting it just 403s. Guessing the wrong
 * month is worse here than in page discovery, where the listing only ever shows
 * files that exist.
 */
export function newestPublishedMonth(now: Date, publishDay = 12): { y: number; m: number } {
  const back = now.getUTCDate() >= publishDay ? 1 : 2;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/** Construct URLs for the newest `months` data months, newest first. */
export function hdfcConstructed(months: number, now = new Date()): FetchItem[] {
  const newest = newestPublishedMonth(now);
  const items: FetchItem[] = [];
  for (let back = 0; back < months; back++) {
    const d = new Date(Date.UTC(newest.y, newest.m - 1 - back, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    for (const scheme of HDFC_SCHEMES) {
      const url = hdfcUrl(scheme, y, m);
      items.push({ url, filename: filenameOf(url), fundNameHint: scheme });
    }
  }
  return items;
}

async function hdfcDiscover(months: number): Promise<FetchItem[]> {
  let links: string[] = [];
  try {
    links = await discoverLinks(
      "https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio",
      /files\.hdfcfund\.com\/.*Monthly.*\.xlsx$/i,
    );
  } catch {
    return hdfcConstructed(months);
  }

  // Keep only the curated top HDFC equity funds (by AUM).
  const current = links.filter((u) => keepTopFundFile("HDFC", filenameOf(u)));
  if (!current.length) return hdfcConstructed(months);

  // Reference month from the first dated filename.
  const ref = current.map((u) => parseDate(filenameOf(u))).find(Boolean);
  const items: FetchItem[] = [];
  for (let back = 0; back < months; back++) {
    for (const url of current) {
      const item = back === 0 ? url : shiftHdfcMonth(url, back, ref);
      if (!item) continue;
      const fn = filenameOf(item);
      items.push({ url: item, filename: fn, fundNameHint: hdfcName(fn) });
    }
  }
  return items;
}

// Rewrite an HDFC URL back `back` months (folder + filename date). Works on
// the decoded URL, then re-encodes spaces.
function shiftHdfcMonth(
  url: string,
  back: number,
  ref: { y: number; m: number; d: number } | null | undefined,
): string | null {
  const dec = decodeURIComponent(url);
  const d = parseDate(filenameOf(url)) ?? ref;
  if (!d) return null;
  // Target data-month = file's dated month shifted back.
  const base = new Date(Date.UTC(d.y, d.m - 1, 1));
  base.setUTCMonth(base.getUTCMonth() - back);
  const ty = base.getUTCFullYear();
  const tm = base.getUTCMonth() + 1; // 1-12
  const newDate = `${lastDay(ty, tm)} ${MONTH_NAMES[tm]} ${ty}`;
  // Folder is the month AFTER the data month (April data → /2026-05/).
  const fldr = new Date(Date.UTC(ty, tm, 1));
  const folder = `${fldr.getUTCFullYear()}-${String(fldr.getUTCMonth() + 1).padStart(2, "0")}`;
  const out = dec
    .replace(/\/\d{4}-\d{2}\//, `/${folder}/`)
    .replace(/\d{1,2}\s+[A-Za-z]+\s+\d{4}(?=\.xlsx)/i, newDate);
  return out.replace(/ /g, "%20");
}

function hdfcName(filename: string): string {
  // "Monthly HDFC Value Fund - 30 April 2026.xlsx" -> "HDFC Value Fund"
  return filename
    .replace(/\.xlsx$/i, "")
    .replace(/^Monthly\s+/i, "")
    .replace(/\s*-\s*\d.*$/, "")
    .trim();
}

// ---- Axis: consolidated monthly workbook, discovered via AdvisorKhoj -------
// ---- Generic AdvisorKhoj route ---------------------------------------------
// AdvisorKhoj's download centre mirrors monthly-portfolio links for many AMCs
// with no bot protection (proven with Axis). Filenames are wildly inconsistent
// across AMCs ("31st May 2026", "May26", "30042026", "May 31, 2026"), so we
// date them with a fuzzy month extractor and keep the newest `months` distinct
// months.

/** Extract a sortable YYYYMM key from a messy filename/URL, or 0. Exported for tests. */
export function fuzzyMonthKey(s: string): number {
  const dec = decodeURIComponent(s);
  const ok = (y: number, m: number) =>
    m >= 1 && m <= 12 && y >= 2020 && y <= 2035 ? y * 100 + m : 0;
  const yr = (v: string) => (v.length === 2 ? 2000 + Number(v) : Number(v));

  // "31st May 2026", "29-May-2026", "30 April 2026", "31May2026"
  let m = dec.match(/(\d{1,2})(?:st|nd|rd|th)?[-_ .]*([A-Za-z]{3,9})[-_ .]*(\d{4}|\d{2})(?!\d)/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const k = ok(yr(m[3]), MONTHS[m[2].toLowerCase()]);
    if (k) return k;
  }
  // "May 31, 2026"
  m = dec.match(/([A-Za-z]{3,9})[-_ .]*(\d{1,2}),?[-_ .]+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()] && Number(m[2]) <= 31) {
    const k = ok(Number(m[3]), MONTHS[m[1].toLowerCase()]);
    if (k) return k;
  }
  // "31.03.2026", "31-03-2026"
  m = dec.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
  if (m) {
    const k = ok(Number(m[3]), Number(m[2]));
    if (k) return k;
  }
  // "30042026" (DDMMYYYY)
  m = dec.match(/(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/);
  if (m) {
    const k = ok(Number(m[3]), Number(m[2]));
    if (k && Number(m[1]) >= 1 && Number(m[1]) <= 31) return k;
  }
  // "May26", "March2026", "Feb-26", "Nov_2025", "sept-2025"
  m = dec.match(/([A-Za-z]{3,9})[-_ .]*(\d{4}|\d{2})(?!\d)/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const k = ok(yr(m[2]), MONTHS[m[1].toLowerCase()]);
    if (k) return k;
  }
  // "31_05_26", "30 04 26" — all-numeric with a two-digit year. Axis alternates
  // between underscores and spaces, and between its two CDN hosts, so neither
  // the dotted nor the DDMMYYYY form above catches these. Last because a bare
  // numeric triple is the most ambiguous shape here.
  m = dec.match(/(?<!\d)(\d{1,2})[-_. ](\d{1,2})[-_. ](\d{2})(?!\d)/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    const k = ok(2000 + Number(m[3]), Number(m[2]));
    if (k) return k;
  }
  // "June 20261" — AMCs re-uploading a file glue a counter onto the year rather
  // than the stem, so the year no longer ends the digit run.
  m = dec.match(/([A-Za-z]{3,9})[-_ .]*(\d{4})\d(?!\d)/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const k = ok(Number(m[2]), MONTHS[m[1].toLowerCase()]);
    if (k) return k;
  }
  return 0;
}

/**
 * How far below the requested window discovery may reach when the newest links
 * are dead. Covers a couple of stale months without dredging up the years-old
 * strays that sit under some listings' gaps.
 */
const STALE_MONTH_ALLOWANCE = 3;

/** Shift a YYYYMM key back by n months. */
function keyMonthsBack(k: number, n: number): number {
  const y = Math.floor(k / 100);
  const m = (k % 100) - 1 - n; // 0-based month, shifted
  const yy = y + Math.floor(m / 12);
  return yy * 100 + ((((m % 12) + 12) % 12) + 1);
}

function advisorKhojDiscover(
  slug: string,
  linkPattern: RegExp,
  urlReject?: RegExp,
): (months: number) => Promise<FetchItem[]> {
  return async (months) => {
    // AdvisorKhoj serves the full link list as static HTML — plain fetch is
    // both faster and more complete than headless Chrome (whose post-JS DOM
    // has dropped links for some AMCs).
    const res = await fetch(
      `https://www.advisorkhoj.com/form-download-centre/Mutual/${slug}/Monthly-Portfolio-Disclosures`,
      { headers: { "user-agent": UA } },
    );
    if (!res.ok) throw new Error(`advisorkhoj page ${res.status} for ${slug}`);
    const html = await res.text();
    const links = [
      ...new Set(
        [...html.matchAll(/href="([^"]+)"/gi)]
          .map((m) => m[1])
          .filter((h) => linkPattern.test(h)),
      ),
    ];
    const dated = links
      .filter((u) => !urlReject || !urlReject.test(decodeURIComponent(u)))
      .map((url) => ({ url, k: fuzzyMonthKey(filenameOf(url)) || fuzzyMonthKey(url) }))
      .filter((x) => x.k > 0)
      .sort((a, b) => b.k - a.k);
    if (!dated.length) return [];
    // One file per month (AMCs post corrections like "(1).xlsx" — page order
    // lists the newest first, so first seen per month wins).
    //
    // Dead links must not consume the month budget. AdvisorKhoj's Motilal rows
    // point at 404s for the two newest months while older ones resolve fine, so
    // a naive "newest N" yields nothing at all. Candidates are probed and
    // skipped when definitively gone, walking back until N live months are
    // found. The scan is bounded so a wholly broken listing cannot turn into an
    // unbounded crawl, and the window still ignores the years-old strays that
    // sit below a listing's gaps.
    const cutoff = keyMonthsBack(dated[0].k, months - 1 + STALE_MONTH_ALLOWANCE);
    const seen = new Set<number>();
    const out: FetchItem[] = [];
    for (const x of dated) {
      if (x.k < cutoff || out.length >= months) break;
      if (seen.has(x.k)) continue;
      seen.add(x.k);
      if (!(await isLikelyLive(x.url))) continue;
      out.push({ url: x.url, filename: filenameOf(x.url) });
    }
    return out;
  };
}

async function notImplemented(): Promise<FetchItem[]> {
  throw new Error("source not yet wired (JS-SPA site — needs bespoke scraper)");
}

export const AMC_SOURCES: AmcSource[] = [
  {
    // Nippon's own downloads page renders its links client-side, so it is the
    // one source that actually needed a browser. AdvisorKhoj mirrors the same
    // consolidated workbooks as static links, current through the latest month.
    amc: "Nippon India Mutual Fund",
    enabled: true,
    months: 2,
    discover: advisorKhojDiscover(
      "Nippon-India-Mutual-Fund",
      /NIMF-MONTHLY-PORTFOLIO.*\.xlsx?$/i,
    ),
  },
  { amc: "HDFC Mutual Fund", enabled: true, months: 2, discover: hdfcDiscover },
  {
    // Axis serves the same series from two hosts (www. and transact.) and flips
    // its naming between "Monthly Portfolio-30 04 26.xlsx" and
    // "Monthly_Portfolio_31_05_26.xlsx", so match the filename shape rather
    // than a host or a fixed separator. "Adhoc Portfolios" are one-off
    // disclosures outside the monthly series and would otherwise look newest.
    amc: "Axis Mutual Fund",
    enabled: true,
    months: 2,
    discover: advisorKhojDiscover(
      "Axis-Mutual-Fund",
      /axismf\.com\/.*Monthly[%20_ ]*Portfolio.*\.xlsx?$/i,
      /Adhoc/i,
    ),
  },
  // AdvisorKhoj mirror route — consolidated monthly workbooks, verified live.
  {
    amc: "Tata Mutual Fund",
    enabled: true,
    months: 2,
    discover: advisorKhojDiscover(
      "Tata-Mutual-Fund",
      /tatamutualfund\.com\/.*Monthly.*Portfolio.*\.xlsx$/i,
    ),
  },
  {
    amc: "Franklin Templeton Mutual Fund",
    enabled: true,
    months: 2,
    discover: advisorKhojDiscover(
      "Franklin-Templeton-Mutual-Fund",
      /franklintempletonindia\.com\/download\/.*Monthly-Portfolio.*\.xlsx$/i,
    ),
  },
  {
    amc: "Motilal Oswal Mutual Fund",
    enabled: true,
    months: 2,
    discover: advisorKhojDiscover(
      "Motilal-Oswal-Mutual-Fund",
      /motilaloswalmf\.com\/.*\.xlsx?$/i,
      /factsheet/i, // factsheet workbooks are summaries, not full portfolios
    ),
  },
  {
    amc: "Edelweiss Mutual Fund",
    enabled: true,
    months: 2,
    discover: advisorKhojDiscover(
      "Edelweiss-Mutual-Fund",
      /edelweissmf\.com\/.*Monthly.*\.xlsx$/i,
      /\/SIF\/|Long[_ ]?Short|Altiva/i, // SIF long-short strategies aren't MF schemes
    ),
  },
  {
    amc: "Quant Mutual Fund",
    enabled: true,
    months: 2,
    discover: advisorKhojDiscover(
      "Quant-Mutual-Fund",
      /quantmutual\.com\/Admin\/disclouser\/.*\.xlsx$/i,
    ),
  },
  {
    // Aditya Birla SL ships the consolidated workbook inside a ZIP; the sync
    // path unwraps it (src/lib/archive.ts). Filenames are the least consistent
    // of any AMC here ("30-june-2026", "31052026", "april-30-2026",
    // "mar-2026"), which the fuzzy month parser handles. Two CDN hosts serve
    // the same media path, so the pattern matches on path, not host.
    amc: "Aditya Birla Sun Life Mutual Fund",
    enabled: true,
    months: 2,
    discover: advisorKhojDiscover(
      "Aditya-Birla-Sun-Life-Mutual-Fund",
      /\/monthly-portfolio\/\d{4}\/[^/]+\.zip$/i,
    ),
  },
  // UTI publishes on AdvisorKhoj as ZIPs too, but only two exist and the newest
  // is Feb 2026 — enabling it would inject a stale, isolated month rather than
  // extend the timeline. DSP/Mirae/PPFAS/Canara Robeco/Bandhan have no files
  // on AdvisorKhoj.
  // SBI & ICICI publish only factsheet PDFs publicly (summarized top holdings),
  // not full monthly-portfolio workbooks; their full files sit behind WAF-
  // protected SPAs. Kotak's portfolio page is a JS SPA with no static links.
  { amc: "SBI Mutual Fund", enabled: false, months: 2, discover: notImplemented },
  { amc: "ICICI Prudential Mutual Fund", enabled: false, months: 2, discover: notImplemented },
  { amc: "Kotak Mutual Fund", enabled: false, months: 2, discover: notImplemented },
];

export const enabledSources = () => AMC_SOURCES.filter((s) => s.enabled);
