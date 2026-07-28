// Headless-Chrome link discovery for JS-rendered AMC download pages.
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Load a page in headless Chrome and return all hrefs matching `pattern`. */
export async function discoverLinks(
  pageUrl: string,
  pattern: RegExp,
  waitMs = 3000,
): Promise<string[]> {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, waitMs));
    const hrefs: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map(
        (a) => (a as HTMLAnchorElement).href,
      ),
    );
    return [...new Set(hrefs.filter((h) => pattern.test(h)))];
  } finally {
    await browser.close();
  }
}

/** Fetch a file URL into memory (plain fetch with a browser UA). */
export async function fetchFile(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Download a file URL straight to disk. */
export async function downloadFile(url: string, destPath: string): Promise<number> {
  const { writeFile } = await import("node:fs/promises");
  const buf = await fetchFile(url);
  await writeFile(destPath, buf);
  return buf.length;
}
