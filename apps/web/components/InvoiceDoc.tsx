"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Endorsement, Invoice } from "@/lib/types";
import { date, short, time, usd } from "@/lib/format";
import { StatusStamp } from "./StatusStamp";

function verb(e: Endorsement): { text: string; who: string } {
  const amt = e.amount ? usd(e.amount) : "";
  switch (e.kind) {
    case "Issued": return { text: "Issued", who: e.by };
    case "Confirmed": return { text: "Confirmed as owed", who: e.by };
    case "Listed": return { text: `Offered for ${amt}`, who: e.by };
    case "Delisted": return { text: "Withdrawn from sale", who: e.by };
    case "Sold": return { text: `Sold for ${amt}`, who: `${e.counterparty ?? "?"} → ${e.by}` };
    case "Transferred": return { text: "Signed over", who: `${e.by} → ${e.counterparty ?? "?"}` };
    case "Paid": return { text: `Paid in full, ${amt}`, who: "received at the invoice account" };
    case "ClaimFailed": return { text: "Payout failed, funds stay put", who: e.by };
    case "Claimed": return { text: `Collected ${amt}`, who: e.by };
  }
}

export function InvoiceDoc({
  invoice,
  held,
  flipped: controlled,
  onFlip,
  compact,
}: {
  invoice: Invoice;
  held?: string;
  flipped?: boolean;
  onFlip?: (f: boolean) => void;
  compact?: boolean;
}) {
  const [local, setLocal] = useState(false);
  const flipped = controlled ?? local;
  const setFlipped = (f: boolean) => (onFlip ? onFlip(f) : setLocal(f));
  const [qr, setQr] = useState("");

  useEffect(() => {
    QRCode.toString(invoice.id, { type: "svg", margin: 0, color: { dark: "#15120d", light: "#ffffff" } }).then(setQr).catch(() => setQr(""));
  }, [invoice.id]);

  const paid = invoice.status === "Paid" || invoice.status === "Claiming" || invoice.status === "Claimed";
  return (
    <div className="doc-stage">
      <div className={`doc ${flipped ? "flipped" : ""}`} style={compact ? { aspectRatio: "1 / 1.2", minHeight: 640 } : undefined}>
        <section className="face front" aria-hidden={flipped} aria-label="Front of the invoice">
          <div className="doc-head">
            <div>
              <p className="doc-title">Invoice</p>
              <span className="doc-no">No. {invoice.number}</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="eyebrow">Issued</span>
              <div className="mono" style={{ fontSize: 13 }}>{date(invoice.issued_ms)}</div>
            </div>
          </div>
          <div className="corner-stamp"><StatusStamp status={invoice.status} big /></div>
          <div className="doc-amount">
            {usd(invoice.amount, { cents: false })}
            <small>USDC</small>
          </div>
          <dl className="doc-grid">
            <div><dt>From</dt><dd className="mono">{short(invoice.issuer, 26)}</dd></div>
            <div><dt>Bill to</dt><dd className="mono">{short(invoice.debtor, 26)}</dd></div>
            <div><dt>Due</dt><dd className="mono">{date(invoice.due_ms)}</dd></div>
            <div><dt>{invoice.status === "Claimed" ? "Collected by" : invoice.status === "Paid" ? "Held at this address" : "Pay to the order of"}</dt><dd className="mono">{invoice.status === "Paid" && held !== undefined ? usd(held) : short(invoice.owner, 26)}</dd></div>
          </dl>
          <div className="payto">
            <div className="qr" aria-hidden dangerouslySetInnerHTML={{ __html: qr }} />
            <div>
              <span className="eyebrow">Pay this NEAR account, from any chain</span>
              <div className="addr">{invoice.id}</div>
            </div>
          </div>
          <div className="flip-hint"><button className="flip-btn" onClick={() => setFlipped(true)}>Endorsements ↻</button></div>
        </section>

        <section className="face back" aria-hidden={!flipped} aria-label="Back of the invoice: endorsements">
          <div className="doc-head">
            <div>
              <p className="doc-title">Endorsements</p>
              <span className="doc-no">{invoice.log.length} {invoice.log.length === 1 ? "entry" : "entries"} recorded on NEAR</span>
            </div>
            <StatusStamp status={invoice.status} />
          </div>
          <div style={{ marginTop: 16, borderBottom: "1px solid var(--ink)", paddingBottom: 10 }}>
            <span className="eyebrow">Pay to the order of</span>
            <div className="serif" style={{ fontSize: 24, fontStyle: "italic", lineHeight: 1.15, wordBreak: "break-all" }}>{invoice.owner}</div>
          </div>
          <ol className="endorse-list">
            {invoice.log.map((e, i) => {
              const v = verb(e);
              return (
                <li key={i}>
                  <span className="verb">{v.text}</span>
                  <span className="when">{date(e.at_ms)} · {time(e.at_ms)}</span>
                  <span className="who">{v.who}</span>
                </li>
              );
            })}
          </ol>
          <div className="flip-hint"><button className="flip-btn" onClick={() => setFlipped(false)}>↻ Front</button></div>
        </section>
      </div>
    </div>
  );
}
