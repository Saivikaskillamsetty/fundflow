// Link discovery and file download over plain HTTP.
//
// This used to drive headless Chrome (puppeteer-core + a system Chromium
// binary), which is what forced the ingest half onto a container host. It turned
// out not to be needed: every AMC page that appeared to require a browser was
// actually doing a header-based bot check, not JS rendering. Sending a full set
// of browser headers gets the same HTML — HDFC returns 403 to a bare fetch and
// 200 with these.
//
// Nippon's own download page is the one genuinely JS-rendered source, so it is
// discovered through AdvisorKhoj instead (see amcs.ts).

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** What a real Chrome navigation sends. Bot checks key off the Sec-Fetch-* set. */
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent": UA,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
};

/** Fetch a page's HTML with browser-shaped headers. */
export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`page ${res.status} for ${url}`);
  return res.text();
}

/**
 * Return every URL on `pageUrl` matching `pattern`, resolved to absolute.
 *
 * Two extraction passes, because AMC sites disagree about where links live:
 *
 * 1. `href` attributes — the ordinary case. Relative values are resolved
 *    against the page, since the old Chrome implementation read `a.href`
 *    (always absolute) and the AMC patterns were written expecting that.
 * 2. Bare absolute URLs anywhere in the document. HDFC's page is Next.js and
 *    ships its portfolio links inside the serialized data payload rather than
 *    in anchors, so an href-only scan finds nothing. Scanning raw text is safe
 *    here because every caller passes a specific host+filename pattern.
 */
export async function discoverLinks(
  pageUrl: string,
  pattern: RegExp,
): Promise<string[]> {
  const raw = await fetchPage(pageUrl);
  // JSON payloads escape slashes; entities show up in both markup and data.
  const html = raw.replace(/\\\//g, "/").replace(/&amp;/g, "&");

  const found = new Set<string>();

  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    try {
      found.add(new URL(m[1], pageUrl).href);
    } catch {
      // malformed href — skip it rather than fail the whole page
    }
  }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)) {
    found.add(m[0]);
  }

  return [...found].filter((h) => pattern.test(h));
}

/**
 * Download a file URL into memory.
 *
 * A 200 is not enough on its own: AMC CDNs answer blocked requests with an
 * HTML page — sometimes a redirect to their homepage, so `res.ok` is true and
 * the body is a plausible size. Stored as-is, that surfaces much later as an
 * opaque parser failure on a file that looks fine. Reject it here, where the
 * cause is still visible.
 */
export async function fetchFile(
  url: string,
  { attempts = 3, delayMs = 400 }: { attempts?: number; delayMs?: number } = {},
): Promise<Buffer> {
  let last = "";
  for (let i = 0; i < attempts; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, delayMs * i));
    // Generous, but bounded: a host that accepts the connection and then stalls
    // would otherwise hold the function open until its duration ceiling.
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    // A missing file will still be missing on the next try.
    if (isGone(res.status)) {
      throw new Error(`download failed ${res.status} for ${url}`);
    }
    if (!res.ok) {
      last = `download failed ${res.status} for ${url}`;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!looksLikeHtml(buf)) return buf;

    // Edelweiss's CDN blocks intermittently: the same URL serves a real
    // workbook moments after answering with an "Access Denied" page, so this
    // is worth retrying rather than failing the month.
    last =
      `expected a document but got an HTML page (${buf.length} bytes) — ` +
      `the host is serving a bot check or error page for ${url}`;
  }
  throw new Error(last);
}

/** Definitively absent, as opposed to refused or temporarily unavailable. */
export function isGone(status: number): boolean {
  return status === 404 || status === 410;
}

/**
 * Whether a discovered link is worth handing to the downloader.
 *
 * Deliberately asymmetric: only a definitive 404/410 disqualifies a candidate.
 * A bot check, a hiccup, or a host that refuses HEAD all count as live, because
 * dropping a good link costs a whole month of holdings while keeping a bad one
 * costs a single failed download that the sync already tolerates.
 */
export async function isLikelyLive(url: string): Promise<boolean> {
  const head = await probe(url, { method: "HEAD" });
  if (head === null || !isGone(head)) return true;
  // HEAD reported it gone — but that alone is not trustworthy. Aditya Birla's
  // CDN answers 404 to every HEAD while serving the same URL happily over GET,
  // so a HEAD-only check silently zeroed the AMC. Confirm with a one-byte
  // ranged GET before discarding a whole month.
  const ranged = await probe(url, { range: "bytes=0-0" });
  return ranged === null || !isGone(ranged);
}

/**
 * A probe is advisory, so it must never outlast its usefulness: several AMC
 * CDNs accept a connection from Vercel and then never answer, and an unbounded
 * fetch inside a function burns the whole duration budget on a check whose
 * answer we are willing to guess. Returns null when there is no usable answer,
 * which every caller treats as "assume live".
 */
async function probe(
  url: string,
  opts: { method?: string; range?: string },
): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        "user-agent": UA,
        ...(opts.range ? { range: opts.range } : {}),
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Release the body so a ranged GET does not leave a socket open.
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch {
    return null;
  }
}

const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? "6000");
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS ?? "60000");

/** True when the payload opens with markup rather than a document signature. */
export function looksLikeHtml(buf: Buffer): boolean {
  // Skip a UTF-8 BOM and leading whitespace before sniffing.
  let i = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) {
    i += 1;
  }
  const head = buf.subarray(i, i + 14).toString("latin1").toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml");
}
