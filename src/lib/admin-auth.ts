// Gate for the few endpoints a browser may trigger.
//
// The dashboard is public and has no user accounts, which is why the sync
// button was removed rather than left to 401: /api/sync fans out to ten
// functions, downloads tens of files, and rewrites every fund — an open button
// is a denial-of-wallet endpoint and a way for anyone to force re-ingestion.
//
// This is deliberately the smallest thing that closes that hole: one passphrase
// in ADMIN_PASSWORD, exchanged for an httpOnly cookie. Not a user system, and
// not a substitute for one if the app ever grows real accounts.
//
// With ADMIN_PASSWORD unset the gate denies everything, so an unconfigured
// deployment is closed rather than open.
import { createHash, timingSafeEqual } from "node:crypto";

const COOKIE = "ff_admin";

/** Constant-time compare that tolerates length mismatch. */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** The cookie value for a given passphrase — never the passphrase itself. */
function tokenFor(password: string): string {
  return createHash("sha256").update(`fundflow:admin:${password}`).digest("hex");
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function verifyPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return sameSecret(input, expected);
}

export function sessionCookie(): string {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD is not set");
  const token = tokenFor(expected);
  // 30 days; httpOnly so page scripts cannot read it, sameSite=lax so it still
  // rides along on ordinary navigation.
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 30}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

/** True when the request carries a cookie minted from the current passphrase. */
export function hasAdminSession(request: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const raw = request.headers.get("cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  return sameSecret(match[1], tokenFor(expected));
}
