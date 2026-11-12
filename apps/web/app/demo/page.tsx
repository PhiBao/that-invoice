"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { useLedger } from "@/lib/store";
import { usd } from "@/lib/format";
import type { Invoice } from "@/lib/types";

interface StepState {
  status: "pending" | "running" | "ok" | "rejected" | "error";
  actor?: string;
  tx?: string;
  url?: string;
  error?: string | null;
  note?: string;
  gas?: number;
  extras?: { label: string; hash: string; explorer_url: string }[];
}

const PLAN: { id: string; index: number; title: string }[] = [
  { id: "fund", index: 0, title: "Check the demo wallets" },
  { id: "issue", index: 1, title: "Studio Nine issues a $1,200 invoice to Acme DAO. It becomes its own NEAR account." },
  { id: "issue_again", index: 2, title: "Attack: Studio Nine issues the same invoice a second time." },
  { id: "confirm", index: 3, title: "Acme DAO confirms it owes the invoice: a proposal is filed, a council member approves it, and the DAO calls the registry." },
  { id: "list", index: 4, title: "Studio Nine lists the invoice for $1,176." },
  { id: "buy", index: 5, title: "Northfield Fund buys it. Ownership and the cash move in one receipt." },
  { id: "relist", index: 6, title: "Attack: Studio Nine tries to sell the invoice again after selling it." },
  { id: "pay", index: 7, title: "Acme DAO pays the invoice account from its treasury, also by proposal." },
  { id: "record", index: 8, title: "The server notices the payment and records it. Nobody presses a button." },
  { id: "claim", index: 9, title: "Northfield Fund, the current owner, claims the payment." },
];

export default function DemoPage() {
  const { state, refresh } = useLedger();
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [running, setRunning] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
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
    // The run lives on the server, so a dropped connection (Wi-Fi blip, mobile network change) must not
    // end it: re-attach with GET and the server replays every step so far, then follows live.
    let method: "POST" | "GET" = "POST";
    let terminal = false;
    let attempts = 0;
    try {
      while (!terminal && attempts < 8) {
        try {
          const res = await fetch("/api/demo/run", { method });
          if (!res.ok || !res.body) {
            const b = await res.json().catch(() => ({}));
            throw Object.assign(new Error(b.error ?? `HTTP ${res.status}`), { fatal: true });
          }
          terminal = await readStream(res.body);
        } catch (e) {
          if ((e as { fatal?: boolean }).fatal) throw e;
        }
        if (!terminal) {
          method = "GET";
          attempts += 1;
          setReconnecting(true);
          await new Promise((r) => setTimeout(r, Math.min(1000 * attempts, 4000)));
        }
      }
      if (!terminal) throw new Error("lost the connection to the server");
    } catch (e) {
      setFatal(e instanceof Error ? e.message : "demo failed");
    } finally {
      setReconnecting(false);
      setRunning(false);
      setElapsed(Math.round((Date.now() - t0.current) / 1000));
      refresh();
    }
  }

  async function readStream(body: ReadableStream<Uint8Array>): Promise<boolean> {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let sawTerminal = false;
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
        const m = JSON.parse(line.slice(5));
        setReconnecting(false);
        handle(m);
        if (m.kind === "done" || m.kind === "error") sawTerminal = true;
      }
    }
    return sawTerminal;
  }

  function handle(m: any) {
    if (m.kind === "step") {
      const id = PLAN.find((p) => p.index === m.index)?.id ?? m.id;
      setSteps((s) => ({
        ...s,
        [id]: { status: m.status, actor: m.actor, tx: m.tx, url: m.explorer_url, error: m.error, note: m.note, gas: m.gas_tgas, extras: m.extras },
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
        real transaction. The two stamped BLOCKED steps are attacks the contract must refuse.
      </p>

      <div className="cols demo-cols">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 6 }}>
            <button className="btn stamp" onClick={run} disabled={running || !state}>
              {running ? (<><span className="spin" /> Running…</>) : done || fatal ? "Run it again" : "Run the demo"}
            </button>
            <span className="mono muted" style={{ fontSize: 12.5 }}>
              {reconnecting ? "reconnecting to the run…" : running ? `${completed}/10 steps` : elapsed !== null ? `${elapsed}s end to end` : "about a minute"}
            </span>
          </div>
          <ol className="timeline">
            {PLAN.map((p) => {
              const s = steps[p.id];
              const st = s?.status ?? "pending";
              return (
                <li key={p.id} className={`step ${st}`}>
                  <span className="dot" aria-hidden>
                    {st === "ok" || st === "rejected" ? "✓" : st === "error" ? "!" : st === "running" ? <span className="spin" /> : p.index}
                  </span>
                  <div>
                    <div className="t">{p.title}</div>
                    {(s?.actor || s?.tx || s?.note) && (
                      <div className="meta">
                        {s.actor && <span>{s.actor}</span>}
                        {s.note && <span>{s.note}</span>}
                        {s.gas !== undefined && <span>{s.gas.toFixed(1)} Tgas</span>}
                        {s.extras?.map((x) => (
                          <a key={x.hash} href={x.explorer_url} target="_blank" rel="noreferrer">{x.label} ↗</a>
                        ))}
                        {s.url && s.tx && <a href={s.url} target="_blank" rel="noreferrer">{p.id === "confirm" || p.id === "pay" ? "approval" : "tx"} {s.tx.slice(0, 8)}… ↗</a>}
                      </div>
                    )}
                    {st === "rejected" && (
                      <div className="why note green">
                        <span className="stamp-tag red" style={{ marginRight: 10 }}>Blocked</span>
                        <b>The contract refused this, as it should.</b>
                        <div style={{ marginTop: 6 }} className="mono">{s?.error}</div>
                      </div>
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
              <b>Settled.</b> The fund collected {usd(invoice.log.findLast((l) => l.kind === "Claimed")?.amount ?? invoice.amount, { cents: false })}, bought for 1,176.
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
