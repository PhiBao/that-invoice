"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { useLedger } from "@/lib/store";
import type { Invoice } from "@/lib/types";

interface StepState {
  status: "pending" | "running" | "ok" | "rejected" | "error";
  actor?: string;
  tx?: string;
  url?: string;
  error?: string | null;
  note?: string;
  gas?: number;
}

const PLAN: { id: string; index: number; title: string }[] = [
  { id: "fund", index: 0, title: "Check the demo wallets" },
  { id: "issue", index: 1, title: "Studio Nine issues a $1,200 invoice to Acme DAO. It becomes its own NEAR account." },
  { id: "issue_again", index: 2, title: "Studio Nine tries to issue the same invoice again." },
  { id: "confirm", index: 3, title: "Acme DAO confirms it owes the invoice." },
  { id: "list", index: 4, title: "Studio Nine lists the invoice for $1,176." },
  { id: "buy", index: 5, title: "Northfield Fund buys it. Ownership and the cash move in one receipt." },
  { id: "relist", index: 6, title: "Studio Nine tries to sell it a second time." },
  { id: "pay", index: 7, title: "Acme DAO pays the invoice account directly." },
  { id: "sync", index: 8, title: "The registry reads the invoice account's balance and marks it paid." },
  { id: "claim", index: 9, title: "Northfield Fund, the current owner, claims the payment." },
];

export default function DemoPage() {
  const { state, refresh } = useLedger();
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [running, setRunning] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const t0 = useRef(0);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const invoice: Invoice | undefined = useMemo(
    () => (invoiceId ? state?.invoices.find((i) => i.id === invoiceId) : undefined),
    [invoiceId, state],
  );

  async function run() {
    setSteps({});
    setFatal(null);
    setDone(false);
    setInvoiceId(null);
    setFlipped(false);
    setElapsed(null);
    setRunning(true);
    t0.current = Date.now();
    try {
      const res = await fetch("/api/demo/run", { method: "POST" });
      if (!res.ok || !res.body) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let cut: number;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const line = block.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          handle(JSON.parse(line.slice(5)));
        }
      }
    } catch (e) {
      setFatal(e instanceof Error ? e.message : "demo failed");
    } finally {
      setRunning(false);
      setElapsed(Math.round((Date.now() - t0.current) / 1000));
      refresh();
    }
  }

  function handle(m: any) {
    if (m.kind === "step") {
      const id = PLAN.find((p) => p.index === m.index)?.id ?? m.id;
      setSteps((s) => ({
        ...s,
        [id]: { status: m.status, actor: m.actor, tx: m.tx, url: m.explorer_url, error: m.error, note: m.note, gas: m.gas_tgas },
      }));
      if (m.invoice_id) setInvoiceId(m.invoice_id);
      if (m.index >= 5 && m.status === "ok") setFlipped(true);
      refresh();
    } else if (m.kind === "error") {
      const id = PLAN.find((p) => p.index === m.index)?.id ?? m.id;
      setSteps((s) => ({ ...s, [id]: { ...(s[id] ?? {}), status: "error", error: m.error, tx: m.tx, url: m.explorer_url } }));
      setFatal(m.error ?? "demo stopped");
    } else if (m.kind === "done") {
      setDone(true);
      if (m.invoice_id) setInvoiceId(m.invoice_id);
    }
  }

  const completed = PLAN.filter((p) => steps[p.id]?.status === "ok" || steps[p.id]?.status === "rejected").length;

  return (
    <div className="wrap page">
      <p className="eyebrow">Live demo · NEAR testnet</p>
      <h1 className="h2" style={{ fontSize: 46, maxWidth: "20ch", marginBottom: 10 }}>An invoice, sold once, paid once.</h1>
      <p className="lede" style={{ marginBottom: 28, fontSize: 16 }}>
        Press run and watch three accounts issue, confirm, sell, pay and collect one invoice. Each line is a
        real transaction. The two red steps are attempts the contract refuses.
      </p>

      <div className="cols" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,440px)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 6 }}>
            <button className="btn stamp" onClick={run} disabled={running || !state}>
              {running ? (<><span className="spin" /> Running…</>) : done || fatal ? "Run it again" : "Run the demo"}
            </button>
            <span className="mono muted" style={{ fontSize: 12.5 }}>
              {running ? `${completed}/10 steps` : elapsed !== null ? `${elapsed}s end to end` : "about 45 seconds"}
            </span>
          </div>
          <ol className="timeline">
            {PLAN.map((p) => {
              const s = steps[p.id];
              const st = s?.status ?? "pending";
              return (
                <li key={p.id} className={`step ${st}`}>
                  <span className="dot" aria-hidden>
                    {st === "ok" ? "✓" : st === "rejected" ? "✕" : st === "error" ? "!" : st === "running" ? <span className="spin" /> : p.index}
                  </span>
                  <div>
                    <div className="t">{p.title}</div>
                    {(s?.actor || s?.tx || s?.note) && (
                      <div className="meta">
                        {s.actor && <span>{s.actor}</span>}
                        {s.note && <span>{s.note}</span>}
                        {s.gas !== undefined && <span>{s.gas.toFixed(1)} Tgas</span>}
                        {s.url && <a href={s.url} target="_blank" rel="noreferrer">{s.tx?.slice(0, 10)}… ↗</a>}
                      </div>
                    )}
                    {st === "rejected" && (
                      <div className="why note"><b>Refused by the contract:</b> {s?.error}</div>
                    )}
                    {st === "error" && <div className="why note"><b>Stopped:</b> {s?.error}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
          {fatal && !running && <div className="note" style={{ marginTop: 18 }}>The run stopped early: {fatal}</div>}
          {done && invoice && (
            <div className="note green" style={{ marginTop: 18 }}>
              <b>Settled.</b> The fund collected {Number(BigInt(invoice.received) / 1000000n).toLocaleString()} USDC, bought for 1,176.
              Studio Nine got its cash on day one. <Link href={`/i/${invoice.id}`}>Open the invoice →</Link>
            </div>
          )}
        </div>

        <div style={{ position: "sticky", top: 24 }}>
          {invoice ? (
            <InvoiceDoc invoice={invoice} flipped={flipped} onFlip={setFlipped} compact />
          ) : (
            <div className="empty" style={{ aspectRatio: "1 / 1.02", display: "grid", placeItems: "center" }}>
              The invoice appears here as soon as it is issued.
            </div>
          )}
          {invoice && <p className="mono muted" style={{ fontSize: 12, marginTop: 12 }}>{invoice.id}</p>}
        </div>
      </div>
    </div>
  );
}
