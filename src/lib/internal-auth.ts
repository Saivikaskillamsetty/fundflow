// Shared secret for endpoints that must not be publicly triggerable: the cron
// entrypoint and the per-AMC worker it fans out to. Both do real work (network
// fetches, writes, parser invocations), so an open endpoint would be a free
// denial-of-wallet and a way to force arbitrary re-ingestion.
//
// Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations,
// so the same secret covers both callers.

export class Unauthorized extends Error {}

/** Throws `Unauthorized` unless the request carries the cron secret. */
export function requireInternalAuth(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Unauthorized("CRON_SECRET is not configured");

  const header =
    request.headers.get("authorization") ??
    (request.headers.get("x-internal-secret")
      ? `Bearer ${request.headers.get("x-internal-secret")}`
      : null);

  if (header !== `Bearer ${secret}`) throw new Unauthorized("unauthorized");
}

/**
 * Origin to call sibling functions on.
 *
 * VERCEL_URL first, deliberately: it is *this* deployment. Preferring
 * VERCEL_PROJECT_PRODUCTION_URL would make every preview call production's
 * functions instead of its own, so a preview would silently exercise the
 * currently-deployed code rather than the code under test.
 */
export function selfOrigin(request: Request): string {
  const host = process.env.VERCEL_URL || request.headers.get("host");
  if (!host) throw new Error("cannot determine deployment origin");
  return host.startsWith("http") ? host : `https://${host}`;
}

/**
 * Headers every internal self-call needs.
 *
 * Preview deployments sit behind Vercel Authentication, which would 401 a
 * function calling its own sibling. Vercel injects the automation bypass secret
 * when one is configured; forwarding it is what makes previews self-testable.
 * Production has no such protection, so the header is simply absent there.
 */
export function internalHeaders(secret: string): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return headers;
}
