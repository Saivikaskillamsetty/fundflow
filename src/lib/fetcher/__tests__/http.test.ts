// discoverLinks replaced headless Chrome. Chrome read `a.href`, which is always
// absolute and always an anchor; plain HTML is neither, so these pin the two
// extraction passes and the URL resolution that Chrome used to do for free.
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverLinks, fetchPage } from "@/lib/fetcher/http";

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
