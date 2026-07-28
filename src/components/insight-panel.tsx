"use client";

import { useState } from "react";

function renderMarkdown(md: string) {
  // Minimal renderer: **bold**, bullet lists, paragraphs.
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="ml-4 list-disc space-y-0.5">
          {list}
        </ul>,
      );
      list = [];
    }
  };
  const inline = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="text-foreground">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      list.push(<li key={`li-${list.length}`}>{inline(line.slice(2))}</li>);
    } else {
      flush();
      out.push(
        <p key={`p-${out.length}`} className="text-muted">
          {inline(line)}
        </p>,
      );
    }
  }
  flush();
  return out;
}

export function InsightPanel({
  stockId,
  initial,
}: {
  stockId: number;
  initial: string | null;
}) {
  const [body, setBody] = useState<string | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights/${stockId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate insight");
      setBody(data.insight);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 text-xs leading-relaxed">
      <button
        onClick={generate}
        disabled={loading}
        className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
      >
        {loading ? "Analyzing…" : body ? "↻ Regenerate AI insight" : "✨ Generate AI insight"}
      </button>
      {error && <div className="text-down">{error}</div>}
      {body ? (
        <div className="space-y-2">{renderMarkdown(body)}</div>
      ) : (
        !loading && (
          <p className="text-muted">
            No AI narrative yet. Generate one to summarize the institutional
            activity for this stock.
          </p>
        )
      )}
    </div>
  );
}
