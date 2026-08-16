// Email the monthly sync summary directly from the cron, via Resend's REST
// API. Lives in the deployment rather than any local machine so the report
// arrives even when no laptop is awake.
//
// Configuration (all optional — without a key this module is a no-op, so the
// cron works before Resend is set up and in previews):
//   RESEND_API_KEY    enables sending
//   REPORT_EMAIL_TO   recipient (required to send)
//   REPORT_EMAIL_FROM sender; Resend's shared onboarding address by default,
//                     which may only deliver to the account owner's own email.
import { db } from "@/db";
import { funds, holdings } from "@/db/schema";
import { max, countDistinct, eq, sql } from "drizzle-orm";
import type { FanoutSummary } from "@/lib/fanout";

const FROM_DEFAULT = "FundFlow <onboarding@resend.dev>";

export function composeReport(
  summary: FanoutSummary,
  newestByAmc: { amc: string; newest: string | null; funds: number }[],
  signalMix: { month: string; signal: string; count: number }[],
  advanced: string[] = [],
): { subject: string; text: string } {
  const newest =
    newestByAmc.reduce<string | null>(
      (acc, r) => (r.newest && (!acc || r.newest > acc) ? r.newest : acc),
      null,
    ) ?? "unknown";

  const lines: string[] = [];
  lines.push(`FundFlow monthly sync — run ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  // `ingested` counts scheme-months, not schemes: every AMC fetches the two
  // newest months, so a fund it still holds is ingested once per month. Calling
  // that "funds" made the run look like it covered twice the universe the
  // dashboard reports.
  lines.push(
    `This run: ${summary.ingested} scheme-months ingested (each fund counts ` +
      `once per month fetched), ${summary.holdings} holdings, ` +
      `${summary.failed} failed across ${summary.amcs} AMCs.`,
  );
  lines.push("");
  if (advanced.length) {
    lines.push("New data this run:");
    for (const a of advanced) lines.push(`- ${a}`);
  } else {
    lines.push("No AMC advanced to a newer month this run.");
  }
  lines.push("");
  lines.push("Newest month per AMC:");
  for (const r of newestByAmc) {
    lines.push(`- ${r.amc}: ${r.newest ?? "none"} (${r.funds} funds)`);
  }
  lines.push("");
  const newestMix = signalMix.filter((s) => s.month === newest);
  if (newestMix.length) {
    lines.push(
      `Signals for ${newest}: ` +
        newestMix.map((s) => `${s.signal} ${s.count}`).join(" / "),
    );
    lines.push("");
  }
  const errors = summary.results.filter((r) => r.errors.length);
  if (errors.length) {
    lines.push("Errors:");
    for (const r of errors) {
      for (const e of r.errors) lines.push(`- ${r.amc}: ${e}`);
    }
  } else {
    lines.push("No errors.");
  }

  return {
    subject: `FundFlow monthly sync — ${newest} results`,
    text: lines.join("\n"),
  };
}

/**
 * Newest ingested month per AMC, keyed by AMC name. Used to tell whether a run
 * actually advanced anything, which decides whether it is worth an email.
 */
export async function newestMonthByAmc(): Promise<Record<string, string>> {
  const rows = await db
    .select({ amc: funds.amc, newest: max(holdings.reportMonth) })
    .from(funds)
    .innerJoin(holdings, eq(holdings.fundId, funds.id))
    .groupBy(funds.amc);
  return Object.fromEntries(
    rows.filter((r) => r.newest).map((r) => [r.amc, r.newest as string]),
  );
}

async function gatherContext() {
  const newestByAmc = await db
    .select({
      amc: funds.amc,
      newest: max(holdings.reportMonth),
      funds: countDistinct(funds.id),
    })
    .from(funds)
    .innerJoin(holdings, eq(holdings.fundId, funds.id))
    .groupBy(funds.amc)
    .orderBy(funds.amc);

  const signalMix = (await db.execute(
    sql`SELECT report_month AS month, signal, count(*)::int AS count
        FROM signals GROUP BY 1, 2 ORDER BY 1, 2`,
  )) as unknown as { month: string; signal: string; count: number }[];

  return { newestByAmc, signalMix };
}

/**
 * Send the run report. Returns what happened rather than throwing: a failed
 * email must never mark an otherwise successful sync as failed.
 */
export async function sendSyncReport(
  summary: FanoutSummary,
  advanced: string[] = [],
): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_EMAIL_TO;
  if (!key) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!to) return { sent: false, reason: "REPORT_EMAIL_TO not set" };

  try {
    const { newestByAmc, signalMix } = await gatherContext();
    const { subject, text } = composeReport(summary, newestByAmc, signalMix, advanced);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.REPORT_EMAIL_FROM || FROM_DEFAULT,
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `Resend HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
