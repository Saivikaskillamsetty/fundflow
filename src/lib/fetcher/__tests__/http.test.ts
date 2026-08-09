// discoverLinks replaced headless Chrome. Chrome read `a.href`, which is always
// absolute and always an anchor; plain HTML is neither, so these pin the two
// extraction passes and the URL resolution that Chrome used to do for free.
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverLinks, fetchFile, fetchPage, isLikelyLive } from "@/lib/fetcher/http";

function mockPage(html: string, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      text: async () => html,
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

const PAGE = "https://amc.example.com/downloads/monthly";

describe("discoverLinks", () => {
  it("finds links in href attributes", async () => {
    mockPage(`<a href="https://files.example.com/Monthly Portfolio.xlsx">x</a>`);
    const links = await discoverLinks(PAGE, /Monthly.*\.xlsx$/i);
    expect(links).toEqual(["https://files.example.com/Monthly%20Portfolio.xlsx"]);
  });

  it("resolves relative hrefs against the page", async () => {
    mockPage(`<a href="/files/Monthly.xlsx">x</a>`);
    const links = await discoverLinks(PAGE, /Monthly\.xlsx$/i);
    expect(links).toEqual(["https://amc.example.com/files/Monthly.xlsx"]);
  });

  it("finds bare URLs outside anchors", async () => {
    // HDFC's page is Next.js and ships portfolio links inside its serialized
    // data payload, not in anchors — an href-only scan returns nothing.
    mockPage(
      `<script>{"props":{"file":"https://files.example.com/Monthly.xlsx"}}</script>`,
    );
    const links = await discoverLinks(PAGE, /Monthly\.xlsx$/i);
    expect(links).toEqual(["https://files.example.com/Monthly.xlsx"]);
  });

  it("unescapes JSON-escaped slashes", async () => {
    mockPage(`{"url":"https:\\/\\/files.example.com\\/Monthly.xlsx"}`);
    const links = await discoverLinks(PAGE, /Monthly\.xlsx$/i);
    expect(links).toEqual(["https://files.example.com/Monthly.xlsx"]);
  });

  it("decodes &amp; so query strings match", async () => {
    mockPage(`<a href="https://files.example.com/Monthly.xlsx?a=1&amp;b=2">x</a>`);
    const links = await discoverLinks(PAGE, /Monthly\.xlsx\?a=1&b=2$/i);
    expect(links).toHaveLength(1);
  });

  it("deduplicates a link that appears in both passes", async () => {
    mockPage(
      `<a href="https://files.example.com/Monthly.xlsx">x</a>
       <script>"https://files.example.com/Monthly.xlsx"</script>`,
    );
    const links = await discoverLinks(PAGE, /Monthly\.xlsx$/i);
    expect(links).toEqual(["https://files.example.com/Monthly.xlsx"]);
  });

  it("applies the caller's pattern rather than returning everything", async () => {
    mockPage(
      `<a href="https://files.example.com/Monthly.xlsx">x</a>
       <a href="https://files.example.com/Factsheet.pdf">y</a>
       <a href="https://tracker.example.com/pixel.gif">z</a>`,
    );
    const links = await discoverLinks(PAGE, /\.xlsx$/i);
    expect(links).toEqual(["https://files.example.com/Monthly.xlsx"]);
  });

  it("skips malformed hrefs instead of failing the page", async () => {
    mockPage(
      `<a href="ht!tp://[[[">bad</a><a href="https://files.example.com/Monthly.xlsx">ok</a>`,
    );
    const links = await discoverLinks(PAGE, /Monthly\.xlsx$/i);
    expect(links).toEqual(["https://files.example.com/Monthly.xlsx"]);
  });

  it("returns empty rather than throwing when nothing matches", async () => {
    mockPage(`<a href="/about">about</a>`);
    await expect(discoverLinks(PAGE, /\.xlsx$/i)).resolves.toEqual([]);
  });
});

describe("fetchPage", () => {
  it("surfaces the status on a bot-block so the caller can fall back", async () => {
    // HDFC 403s datacenter IPs; hdfcDiscover keys its fallback off this throw.
    mockPage("", false, 403);
    await expect(fetchPage(PAGE)).rejects.toThrow(/page 403 for/);
  });

  it("sends browser headers, which is what gets past the bot checks", async () => {
    mockPage("<html></html>");
    await fetchPage(PAGE);
    const headers = (globalThis.fetch as unknown as { mock: { calls: [string, { headers: Record<string, string> }][] } })
      .mock.calls[0][1].headers;
    expect(headers["user-agent"]).toMatch(/Chrome\//);
    expect(headers["sec-fetch-mode"]).toBe("navigate");
    expect(headers["accept-language"]).toBeDefined();
  });
});

// A blocked download is the failure mode most likely to be mistaken for a
// parser bug: the CDN answers 200 with an HTML page, so only the bytes reveal
// it. Edelweiss shipped a 794KB homepage this way.
describe("fetchFile", () => {
  function mockBody(bytes: Buffer, ok = true, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok,
        status,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      })),
    );
  }

  const FILE = "https://amc.example.com/portfolio.xlsx";

  it("returns the bytes of a real workbook", async () => {
    const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]); // PK zip
    mockBody(xlsx);
    await expect(fetchFile(FILE)).resolves.toEqual(xlsx);
  });

  it("rejects an HTML page served with a 200", async () => {
    mockBody(Buffer.from("<!DOCTYPE html><html><body>Access Denied</body></html>"));
    await expect(fetchFile(FILE)).rejects.toThrow(/HTML page/i);
  });

  it("sees through leading whitespace and a BOM", async () => {
    mockBody(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("\n  <html>hi</html>")]));
    await expect(fetchFile(FILE)).rejects.toThrow(/HTML page/i);
  });

  it("still reports a non-200 by status", async () => {
    mockBody(Buffer.from("nope"), false, 404);
    await expect(fetchFile(FILE)).rejects.toThrow(/404/);
  });
});

// A HEAD-only liveness check silently zeroed Aditya Birla, whose CDN 404s every
// HEAD while serving the same URL over GET.
describe("isLikelyLive", () => {
  function mockProbe(byMethod: (method: string) => number) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { method?: string }) => {
        const status = byMethod(init?.method ?? "GET");
        return { ok: status < 400, status };
      }),
    );
  }
  const URL_ = "https://cdn.example.com/portfolio.zip";

  it("accepts a link HEAD reports as present", async () => {
    mockProbe(() => 200);
    await expect(isLikelyLive(URL_)).resolves.toBe(true);
  });

  it("keeps a link that 404s on HEAD but serves a ranged GET", async () => {
    mockProbe((m) => (m === "HEAD" ? 404 : 206));
    await expect(isLikelyLive(URL_)).resolves.toBe(true);
  });

  it("discards a link only when both agree it is gone", async () => {
    mockProbe(() => 404);
    await expect(isLikelyLive(URL_)).resolves.toBe(false);
  });

  it("assumes live when the probe itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await expect(isLikelyLive(URL_)).resolves.toBe(true);
  });

  it("treats a bot check as live rather than gone", async () => {
    mockProbe(() => 403);
    await expect(isLikelyLive(URL_)).resolves.toBe(true);
  });
});
