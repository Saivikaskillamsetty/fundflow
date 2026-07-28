// Per-AMC monthly-portfolio sources. Each AMC exposes data differently, so
// each provides a `discover(months)` strategy returning the files to download.
//
// Verified live: Nippon (one consolidated workbook per month) and HDFC (one
// file per scheme per month). SBI/ICICI/Axis/Kotak serve portfolios through
// JS single-page apps / month-dropdowns with no static links — each needs a
// bespoke interaction or reverse-engineered API and is left disabled.
import { discoverLinks, UA } from "@/lib/fetcher/headless";
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

// ---- Nippon: one consolidated workbook per month, dated history -----------
async function nipponDiscover(months: number): Promise<FetchItem[]> {
  const links = await discoverLinks(
    "https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures",
    /MONTHLY-PORTFOLIO.*\.xls(x)?$/i,
  );
  const dated = links
    .map((url) => ({ url, dt: parseDate(url) }))
    .filter((x) => x.dt)
    .sort((a, b) => key(b.dt!) - key(a.dt!));
  return dated.slice(0, months).map((x) => ({ url: x.url, filename: filenameOf(x.url) }));
}

// ---- HDFC: one file per scheme per month, predictable folder pattern ------
// Current-month links live on the page; prior months are reached by rewriting
// the /YYYY-MM/ folder + the "DD Month YYYY" date in each filename.
async function hdfcDiscover(months: number): Promise<FetchItem[]> {
  const links = await discoverLinks(
    "https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio",
    /files\.hdfcfund\.com\/.*Monthly.*\.xlsx$/i,
  );
  // Keep only the curated top HDFC equity funds (by AUM).
  const current = links.filter((u) => keepTopFundFile("HDFC", filenameOf(u)));
  if (!current.length) return [];

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

function key(d: { y: number; m: number; d: number }) {
  return d.y * 10000 + d.m * 100 + d.d;
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
// Axis's own site is a bot-protected SPA, but AdvisorKhoj links straight to the
// AMC's "Monthly Portfolio-DD MM YY.xlsx" files (dated history).
async function axisDiscover(months: number): Promise<FetchItem[]> {
  const links = await discoverLinks(
    "https://www.advisorkhoj.com/form-download-centre/Mutual/Axis-Mutual-Fund/Monthly-Portfolio-Disclosures",
    /Monthly[%20 ]*Portfolio.*\.xlsx$/i,
  );
  const dated = links
    .map((url) => {
      const m = decodeURIComponent(url).match(/(\d{2})\s+(\d{2})\s+(\d{2})/);
      const k = m ? 200000 + Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
      return { url, k };
    })
    .filter((x) => x.k)
    .sort((a, b) => b.k - a.k);
  return dated.slice(0, months).map((x) => ({ url: x.url, filename: filenameOf(x.url) }));
}

// ---- Generic AdvisorKhoj route ---------------------------------------------
// AdvisorKhoj's download centre mirrors monthly-portfolio links for many AMCs
// with no bot protection (proven with Axis). Filenames are wildly inconsistent
// across AMCs ("31st May 2026", "May26", "30042026", "May 31, 2026"), so we
// date them with a fuzzy month extractor and keep the newest `months` distinct
// months.

/** Extract a sortable YYYYMM key from a messy filename/URL, or 0. */
function fuzzyMonthKey(s: string): number {
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
  return 0;
}

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
    // Ignore anything older than the requested window behind the newest file —
    // some AMC listings have month gaps and then years-old strays (Motilal),
    // which would otherwise pollute the timeline with sparse ancient months.
    const cutoff = keyMonthsBack(dated[0].k, months - 1);
    // One file per month (AMCs post corrections like "(1).xlsx" — page order
    // lists the newest first, so first seen per month wins).
    const seen = new Set<number>();
    const out: FetchItem[] = [];
    for (const x of dated) {
      if (x.k < cutoff) break;
      if (seen.has(x.k)) continue;
      seen.add(x.k);
      out.push({ url: x.url, filename: filenameOf(x.url) });
      if (out.length >= months) break;
    }
    return out;
  };
}

async function notImplemented(): Promise<FetchItem[]> {
  throw new Error("source not yet wired (JS-SPA site — needs bespoke scraper)");
}

export const AMC_SOURCES: AmcSource[] = [
  { amc: "Nippon India Mutual Fund", enabled: true, months: 2, discover: nipponDiscover },
  { amc: "HDFC Mutual Fund", enabled: true, months: 2, discover: hdfcDiscover },
  { amc: "Axis Mutual Fund", enabled: true, months: 2, discover: axisDiscover },
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
  // Aditya Birla SL & UTI publish on AdvisorKhoj too, but only as ZIP bundles
  // (zip extraction not supported yet). DSP/Mirae/PPFAS/Canara Robeco/Bandhan
  // have no files on AdvisorKhoj.
  // SBI & ICICI publish only factsheet PDFs publicly (summarized top holdings),
  // not full monthly-portfolio workbooks; their full files sit behind WAF-
  // protected SPAs. Kotak's portfolio page is a JS SPA with no static links.
  { amc: "SBI Mutual Fund", enabled: false, months: 2, discover: notImplemented },
  { amc: "ICICI Prudential Mutual Fund", enabled: false, months: 2, discover: notImplemented },
  { amc: "Kotak Mutual Fund", enabled: false, months: 2, discover: notImplemented },
];

export const enabledSources = () => AMC_SOURCES.filter((s) => s.enabled);
