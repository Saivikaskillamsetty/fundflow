// LLM insight layer — generates an institutional-activity narrative per stock.
// Provider is pluggable via LLM_PROVIDER:
//   ollama    — free local model (default, no key)
//   groq      — free fast cloud (Llama on Groq, ~500 tok/s; free GROQ_API_KEY)
//   anthropic — Claude (paid ANTHROPIC_API_KEY)
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { insights } from "@/db/schema";
import { getStockDetail } from "@/lib/conviction";

const PROVIDER = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
const ANTHROPIC_MODEL = "claude-opus-4-8";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

/** Running on Vercel rather than a developer's machine. */
function isDeployed(): boolean {
  return Boolean(process.env.VERCEL);
}

async function complete(prompt: string): Promise<string> {
  if (PROVIDER === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error(
        "GROQ_API_KEY not set — get a free key at https://console.groq.com/keys",
      );
    }
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Groq request failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return (data.choices?.[0]?.message?.content ?? "").trim();
  }

  if (PROVIDER === "anthropic") {
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: prompt }],
    });
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }

  // Default: free local Ollama (no API key required).
  //
  // That default only makes sense on a developer's machine. Deployed, it points
  // at a localhost that cannot exist inside a function, and the bare fetch
  // rejection surfaces in the UI as "fetch failed" — which says nothing about
  // the actual problem being an unset environment variable.
  if (isDeployed() && !process.env.LLM_PROVIDER) {
    throw new Error(
      "No AI provider is configured for this deployment. LLM_PROVIDER is unset, " +
        "so it falls back to a local Ollama that does not exist here. Set " +
        "LLM_PROVIDER=groq with GROQ_API_KEY (free key at " +
        "https://console.groq.com/keys), or LLM_PROVIDER=anthropic with " +
        "ANTHROPIC_API_KEY.",
    );
  }

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      options: { temperature: 0.3 },
      messages: [{ role: "user", content: prompt }],
    }),
  }).catch(() => {
    // A refused connection is the common case here, and its message ("fetch
    // failed") names neither the host nor the reason.
    throw new Error(
      `Cannot reach Ollama at ${OLLAMA_URL}. Is \`ollama serve\` running with ` +
        `model "${OLLAMA_MODEL}"? Otherwise set LLM_PROVIDER=groq or anthropic.`,
    );
  });
  if (!res.ok) {
    throw new Error(
      `Ollama request failed (${res.status}). Is \`ollama serve\` running with model "${OLLAMA_MODEL}"?`,
    );
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return (data.message?.content ?? "").trim();
}

function buildPrompt(detail: NonNullable<Awaited<ReturnType<typeof getStockDetail>>>) {
  const { stock, agg, rows, month } = detail;
  const lines = rows
    .map(
      (r) =>
        `- ${r.fund} (${r.amc}): ${r.prevPct?.toFixed(2) ?? "—"}% -> ${r.currPct?.toFixed(2) ?? "0.00"}% [${r.signal}]`,
    )
    .join("\n");
  return `You are an equity analyst summarizing Indian mutual-fund institutional activity for a single stock, for the reporting month ${month}.

Stock: ${stock.name}
Sector: ${stock.sector ?? "Unclassified"}
ISIN: ${stock.isin ?? "n/a"}
Funds buying: ${agg?.fundsBuying ?? 0} | Funds selling: ${agg?.fundsSelling ?? 0} | Funds holding: ${agg?.fundsHolding ?? 0}
Net change in aggregate portfolio weight across funds: ${agg?.netDeltaPct.toFixed(2) ?? "0.00"}%
Conviction score (0-100, 50=neutral): ${agg?.conviction ?? 50}

Per-fund month-over-month changes (% to net assets):
${lines || "(no per-fund data)"}

Write a concise institutional-activity report in Markdown with exactly these sections:
**Summary** (2-3 sentences on net accumulation vs distribution),
**Bullish observations** (bullet list),
**Bearish observations** (bullet list),
**Sector context** (1-2 sentences).
Ground every claim in the numbers above. Do not invent prices, targets, or news. Be direct.`;
}

export async function generateInsight(stockId: number): Promise<string> {
  const detail = await getStockDetail(stockId);
  if (!detail) throw new Error("Stock not found");

  const body = await complete(buildPrompt(detail));

  // Cache on the stock row (latest month).
  await db
    .insert(insights)
    .values({ stockId, reportMonth: detail.month ?? "", body })
    .onConflictDoUpdate({
      target: insights.stockId,
      set: { body, reportMonth: detail.month ?? "" },
    });

  return body;
}

export async function getCachedInsight(stockId: number): Promise<string | null> {
  const [row] = await db
    .select()
    .from(insights)
    .where(eq(insights.stockId, stockId))
    .limit(1);
  return row?.body ?? null;
}
