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
 * Two competing constraints, which is why this is not simply VERCEL_URL:
 *
 * - A preview must call *itself*, not production, or it would silently exercise
 *   the deployed code instead of the code under test. So VERCEL_URL there.
 * - Deployment protection on this project is `all_except_custom_domains`, so in
 *   production the VERCEL_URL host 302s to an SSO login page while the custom
 *   domain serves normally. A self-call to VERCEL_URL therefore gets HTML, and
 *   every AMC fails with a JSON parse error. So the production URL there.
 *
 * Both resolve to the same deployment; only the protection differs.
 */
export function selfOrigin(request: Request): string {
  const deployed =
    (process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : undefined) || process.env.VERCEL_URL;
  // Every Vercel host is served over TLS, so a bare hostname implies https.
  if (deployed) {
    return deployed.startsWith("http") ? deployed : `https://${deployed}`;
  }

  // Off Vercel — `next dev`, a test — assuming https would send the fan-out to
  // a port nothing is listening on and every AMC would come back "fetch
  // failed". Mirror the scheme the request actually arrived on.
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (!host) throw new Error("cannot determine deployment origin");
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
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
