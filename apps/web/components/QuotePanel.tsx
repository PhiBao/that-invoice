"use client";
import { useEffect, useState } from "react";
import type { QuoteResponse } from "@/lib/types";

export function QuotePanel({ amountMicro }: { amountMicro: string }) {
  const [data, setData] = useState<QuoteResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const whole = (Number(BigInt(amountMicro)) / 1e6).toString();
    setData(null);
    setErr(null);
    fetch(`/api/quote?amount=${whole}`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
        if (live) setData(b);
      })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [amountMicro]);

  return (
    <section className="panel">
      <header>
        <b>Pay from any chain</b>
        <span className="eyebrow">NEAR Intents · live dry run</span>
      </header>
      <div className="body">
        {!data && !err && <p className="muted" style={{ margin: 0 }}>Asking NEAR Intents for quotes…</p>}
        {err && <p className="muted" style={{ margin: 0 }}>Quotes are unavailable right now ({err}).</p>}
        {data && (
          <>
            <p style={{ margin: "0 0 8px", fontSize: 13.5, color: "var(--ink-2)" }}>
              To deliver exactly this invoice in USDC on NEAR, a client sends:
            </p>
            {data.quotes.map((q) => (
              <div key={q.chain} className="quote-row">
                <span>{q.label} <span className="muted">USDC</span></span>
                <span className="mono">{Number(q.amount_in_formatted).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className="mono muted" style={{ fontSize: 12 }}>~{q.eta_seconds}s</span>
              </div>
            ))}
            <p className="hint" style={{ marginTop: 12 }}>{data.note}</p>
          </>
        )}
      </div>
    </section>
  );
}
