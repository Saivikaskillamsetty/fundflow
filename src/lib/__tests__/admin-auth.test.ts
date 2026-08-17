// The sync button is the one browser-reachable way to spend real money and
// hammer nine AMC sites, so the gate in front of it is worth pinning.
import { afterEach, describe, expect, it } from "vitest";
import {
  adminConfigured,
  clearCookie,
  hasAdminSession,
  sessionCookie,
  verifyPassword,
} from "@/lib/admin-auth";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

function withCookie(value: string): Request {
  return new Request("https://x.test/", { headers: { cookie: value } });
}

describe("admin gate", () => {
  it("is closed when no passphrase is configured", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(adminConfigured()).toBe(false);
    expect(verifyPassword("anything")).toBe(false);
    // An unconfigured deployment must not be an open one.
    expect(hasAdminSession(withCookie("ff_admin=whatever"))).toBe(false);
  });

  it("accepts a cookie minted from the current passphrase", () => {
    process.env.ADMIN_PASSWORD = "correct horse battery";
    expect(verifyPassword("correct horse battery")).toBe(true);
    const cookie = sessionCookie().split(";")[0];
    expect(hasAdminSession(withCookie(cookie))).toBe(true);
  });

  it("never puts the passphrase in the cookie", () => {
    process.env.ADMIN_PASSWORD = "correct horse battery";
    expect(sessionCookie()).not.toContain("correct horse battery");
  });

  it("rejects a wrong passphrase and a forged cookie", () => {
    process.env.ADMIN_PASSWORD = "correct horse battery";
    expect(verifyPassword("wrong")).toBe(false);
    expect(hasAdminSession(withCookie("ff_admin=deadbeef"))).toBe(false);
    expect(hasAdminSession(withCookie("other=1"))).toBe(false);
    expect(hasAdminSession(new Request("https://x.test/"))).toBe(false);
  });

  it("stops honouring cookies once the passphrase changes", () => {
    process.env.ADMIN_PASSWORD = "old-secret";
    const stale = sessionCookie().split(";")[0];
    process.env.ADMIN_PASSWORD = "new-secret";
    expect(hasAdminSession(withCookie(stale))).toBe(false);
  });

  it("hardens the cookie against script access and cross-site use", () => {
    process.env.ADMIN_PASSWORD = "s";
    const c = sessionCookie();
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(clearCookie()).toContain("Max-Age=0");
  });
});
