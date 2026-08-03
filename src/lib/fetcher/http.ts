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

/** Download a file URL into memory. */
export async function fetchFile(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
