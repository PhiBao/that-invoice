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
    // Quotes come from a third party and can fail for a moment; try a few times before saying so.
    (async () => {
      let last = "";
      for (let attempt = 0; attempt < 4 && live; attempt++) {
        try {
          const r = await fetch(`/api/quote?amount=${whole}`);
          const b = await r.json();
          if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
          if (live) setData(b);
          return;
        } catch (e) {
          last = e instanceof Error ? e.message : "request failed";
          await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        }
      }
      if (live) setErr(last);
    })();
    return () => { live = false; };
  }, [amountMicro]);

  return (
    <section className="panel">
      <header>
        <b>Paying from another chain</b>
        <span className="eyebrow">NEAR Intents · live dry run</span>
      </header>
      <div className="body">
        {!data && !err && <p className="muted" style={{ margin: 0 }}>Asking NEAR Intents for quotes…</p>}
        {err && <p className="muted" style={{ margin: 0 }}>NEAR Intents did not answer just now. This panel only shows a price; the invoice itself is unaffected. Reload to try again.</p>}
        {data && (
          <>
            <p style={{ margin: "0 0 8px", fontSize: 13.5, color: "var(--ink-2)" }}>
              On mainnet, NEAR Intents would deliver exactly this much USDC to the invoice account. A client sends:
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
