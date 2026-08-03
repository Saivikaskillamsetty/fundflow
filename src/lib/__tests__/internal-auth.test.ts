// These guards are the only thing standing in front of endpoints that fetch
// from the internet, run the parser and write to the database. A regression here
// is a denial-of-wallet and a way to force arbitrary re-ingestion, so the
// negative cases matter more than the positive one.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  internalHeaders,
  requireInternalAuth,
  selfOrigin,
  Unauthorized,
} from "@/lib/internal-auth";

const SECRET = "s3cr3t";
const req = (headers: Record<string, string> = {}) =>
  new Request("https://example.com/api/cron/sync", { headers });

const saved = { ...process.env };
beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("requireInternalAuth", () => {
  it("accepts the cron secret as a bearer token", () => {
    expect(() =>
      requireInternalAuth(req({ authorization: `Bearer ${SECRET}` })),
    ).not.toThrow();
  });

  it("accepts the same secret via x-internal-secret", () => {
    expect(() =>
      requireInternalAuth(req({ "x-internal-secret": SECRET })),
    ).not.toThrow();
  });

  it("rejects a missing header", () => {
    expect(() => requireInternalAuth(req())).toThrow(Unauthorized);
  });

  it("rejects a wrong secret", () => {
    expect(() =>
      requireInternalAuth(req({ authorization: "Bearer nope" })),
    ).toThrow(Unauthorized);
  });

  it("rejects the bare secret without the Bearer scheme", () => {
    expect(() => requireInternalAuth(req({ authorization: SECRET }))).toThrow(
      Unauthorized,
    );
  });

  it("fails closed when CRON_SECRET is unset", () => {
    // An unconfigured environment must not become an open endpoint.
    delete process.env.CRON_SECRET;
    expect(() =>
      requireInternalAuth(req({ authorization: "Bearer anything" })),
    ).toThrow(Unauthorized);
  });

  it("fails closed when CRON_SECRET is empty", () => {
    process.env.CRON_SECRET = "";
    expect(() => requireInternalAuth(req({ authorization: "Bearer " }))).toThrow(
      Unauthorized,
    );
  });
});

describe("selfOrigin", () => {
  afterEach(() => {
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  it("uses VERCEL_URL on a preview — its own code, not production's", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "fundflow-abc123.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "fundflow-intelligence.vercel.app";
    expect(selfOrigin(req())).toBe("https://fundflow-abc123.vercel.app");
  });

  it("uses the custom domain in production, which protection exempts", () => {
    // Deployment protection is all_except_custom_domains: in production the
    // VERCEL_URL host 302s to an SSO page, so a self-call there receives HTML
    // and every AMC fails on a JSON parse.
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "fundflow-bbyvhqx8g.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "fundflow-intelligence.vercel.app";
    expect(selfOrigin(req())).toBe("https://fundflow-intelligence.vercel.app");
  });

  it("falls back to VERCEL_URL if production has no custom domain", () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "fundflow-bbyvhqx8g.vercel.app";
    expect(selfOrigin(req())).toBe("https://fundflow-bbyvhqx8g.vercel.app");
  });

  it("falls back to the request host off-platform", () => {
    expect(selfOrigin(req({ host: "localhost:3000" }))).toBe(
      "https://localhost:3000",
    );
  });
});

describe("internalHeaders", () => {
  afterEach(() => {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  });

  it("carries the bearer token", () => {
    expect(internalHeaders(SECRET).authorization).toBe(`Bearer ${SECRET}`);
  });

  it("omits the bypass header when there is nothing to bypass", () => {
    expect(internalHeaders(SECRET)["x-vercel-protection-bypass"]).toBeUndefined();
  });

  it("forwards the bypass secret so previews can call themselves", () => {
    // Preview deployments sit behind Vercel Authentication; without this a
    // function calling its sibling gets a login page instead of JSON.
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass123";
    expect(internalHeaders(SECRET)["x-vercel-protection-bypass"]).toBe("bypass123");
  });
});
